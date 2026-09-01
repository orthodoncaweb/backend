import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export type RateType = 'USD' | 'EUR';

type DolarItem = { fuente?: string; promedio?: number; fechaActualizacion?: string };

export interface RateInfo {
  type: RateType;
  baseCurrency: RateType;
  baseSymbol: string;
  rate: number; // Bs. por unidad de la moneda base
  usdVes: number; // tasa USD->VES (oficial)
  eurUsd?: number; // tasa EUR->USD (solo si base = EUR)
  bsFactor: number; // recargo aplicado al pagar en bolívares (1 = sin recargo)
  bsRate: number; // rate * bsFactor: Bs. efectivos por unidad de la moneda base
  source: string;
  updatedAt: string;
}

// Info de la tasa tal como se cachea: sin el factor, que se lee siempre fresco
// para que un cambio en el panel se refleje de inmediato.
type RawRateInfo = Omit<RateInfo, 'bsFactor' | 'bsRate'>;

const SETTING_KEY = 'exchange_rate_type';
const DOLAR_API = 'https://ve.dolarapi.com/v1/dolares';
const EUR_USD_API = 'https://open.er-api.com/v6/latest/EUR';
const CACHE_MS = 30 * 60 * 1000; // 30 minutos

@Injectable()
export class ExchangeRateService implements OnModuleInit {
  private readonly logger = new Logger(ExchangeRateService.name);
  private cache?: RawRateInfo & { fetchedAt: number };

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  // Registra la tasa del día al iniciar el servidor.
  async onModuleInit() {
    await this.recordDailyRate().catch(() => undefined);
  }

  async getType(): Promise<RateType> {
    const setting = await this.prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    return setting?.value === 'EUR' ? 'EUR' : 'USD';
  }

  async setType(type: RateType): Promise<RateInfo> {
    await this.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      update: { value: type },
      create: { key: SETTING_KEY, value: type },
    });
    this.cache = undefined;
    return this.getRate();
  }

  private async fetchDolar(): Promise<{
    oficial: number;
    paralelo?: number;
    updatedAt: string;
  }> {
    const res = await fetch(DOLAR_API);
    if (!res.ok) throw new Error('dolarapi respondió con error');
    const data = (await res.json()) as DolarItem[];
    const list = Array.isArray(data) ? data : [];
    const oficial = list.find((d) => d.fuente === 'oficial');
    const paralelo = list.find((d) => d.fuente === 'paralelo');
    if (!oficial?.promedio) throw new Error('No se encontró la tasa oficial');
    return {
      oficial: oficial.promedio,
      paralelo: paralelo?.promedio,
      updatedAt: oficial.fechaActualizacion ?? new Date().toISOString(),
    };
  }

  private async fetchEurUsd(): Promise<number> {
    const res = await fetch(EUR_USD_API);
    if (!res.ok) throw new Error('API EUR/USD respondió con error');
    const data = (await res.json()) as { rates?: { USD?: number } };
    const usd = data?.rates?.USD;
    if (!usd) throw new Error('No se encontró la tasa EUR/USD');
    return usd;
  }

  async getRate(): Promise<RateInfo> {
    const type = await this.getType();

    if (this.cache && this.cache.type === type && Date.now() - this.cache.fetchedAt < CACHE_MS) {
      return this.withFactor(this.cache);
    }

    try {
      const dolar = await this.fetchDolar();
      let rate = dolar.oficial;
      let baseCurrency: RateType = 'USD';
      let eurUsd: number | undefined;

      if (type === 'EUR') {
        eurUsd = await this.fetchEurUsd();
        rate = eurUsd * dolar.oficial;
        baseCurrency = 'EUR';
      }

      const info: RawRateInfo & { fetchedAt: number } = {
        type,
        baseCurrency,
        baseSymbol: baseCurrency === 'EUR' ? '€' : '$',
        rate: Number(rate.toFixed(4)),
        usdVes: dolar.oficial,
        eurUsd,
        source: type === 'EUR' ? 'dolarapi (oficial) × EUR/USD' : 'dolarapi (oficial)',
        updatedAt: dolar.updatedAt,
        fetchedAt: Date.now(),
      };
      this.cache = info;
      return this.withFactor(info);
    } catch (err) {
      this.logger.error(`Error al obtener la tasa: ${(err as Error).message}`);
      if (this.cache) return this.withFactor(this.cache);
      throw new ServiceUnavailableException('No se pudo obtener la tasa de cambio');
    }
  }

  // --- Historial diario ---

  @Cron(CronExpression.EVERY_DAY_AT_6AM, { name: 'rate-history' })
  async handleDailyRecord() {
    this.logger.log('Registrando tasa de cambio del día…');
    await this.recordDailyRate().catch((e) =>
      this.logger.error(`No se pudo registrar la tasa: ${(e as Error).message}`),
    );
  }

  async recordDailyRate() {
    const dolar = await this.fetchDolar();
    let eurUsd: number | undefined;
    try {
      eurUsd = await this.fetchEurUsd();
    } catch {
      eurUsd = undefined;
    }

    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    await this.prisma.exchangeRateHistory.upsert({
      where: { day },
      update: {
        usdVesOficial: dolar.oficial,
        usdVesParalelo: dolar.paralelo ?? null,
        eurUsd: eurUsd ?? null,
      },
      create: {
        day,
        usdVesOficial: dolar.oficial,
        usdVesParalelo: dolar.paralelo ?? null,
        eurUsd: eurUsd ?? null,
      },
    });
    this.logger.log(`Tasa registrada para ${day}: USD/VES ${dolar.oficial}`);
    return { day, usdVesOficial: dolar.oficial, usdVesParalelo: dolar.paralelo, eurUsd };
  }

  async getHistory(limit = 60) {
    const rows = await this.prisma.exchangeRateHistory.findMany({
      orderBy: { day: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      day: r.day,
      usdVesOficial: Number(r.usdVesOficial),
      usdVesParalelo: r.usdVesParalelo !== null ? Number(r.usdVesParalelo) : null,
      eurUsd: r.eurUsd !== null ? Number(r.eurUsd) : null,
      createdAt: r.createdAt,
    }));
  }

  // Quita el sello de caché y añade el factor de conversión a bolívares.
  private async withFactor(info: RawRateInfo & { fetchedAt?: number }): Promise<RateInfo> {
    const { fetchedAt: _omit, ...rest } = info;
    void _omit;
    const bsFactor = await this.settings.getBsFactor();
    return { ...rest, bsFactor, bsRate: Number((rest.rate * bsFactor).toFixed(4)) };
  }
}
