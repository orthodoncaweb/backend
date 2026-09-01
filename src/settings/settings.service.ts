import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const WHATSAPP_KEY = 'whatsapp_number';
const BS_FACTOR_KEY = 'bs_conversion_factor';

// Límites del factor de conversión a bolívares. 1 = sin recargo.
export const BS_FACTOR_MIN = 0.5;
export const BS_FACTOR_MAX = 5;
export const BS_FACTOR_DEFAULT = 1;

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(key: string): Promise<string | null> {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    return setting?.value ?? null;
  }

  async set(key: string, value: string) {
    await this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    return { key, value };
  }

  getWhatsapp() {
    return this.get(WHATSAPP_KEY);
  }

  setWhatsapp(number: string) {
    return this.set(WHATSAPP_KEY, number);
  }

  /**
   * Factor que se aplica al precio en dólares cuando el cliente paga en
   * bolívares: precio Bs = precio USD × factor × tasa BCV.
   * Devuelve 1 (sin recargo) si no está configurado o el valor es inválido.
   */
  async getBsFactor(): Promise<number> {
    const raw = await this.get(BS_FACTOR_KEY);
    return normalizeBsFactor(raw);
  }

  async setBsFactor(factor: number): Promise<number> {
    const clamped = clampBsFactor(factor);
    await this.set(BS_FACTOR_KEY, String(clamped));
    return clamped;
  }
}

function clampBsFactor(value: number): number {
  const rounded = Number(value.toFixed(4));
  if (rounded < BS_FACTOR_MIN) return BS_FACTOR_MIN;
  if (rounded > BS_FACTOR_MAX) return BS_FACTOR_MAX;
  return rounded;
}

function normalizeBsFactor(raw: string | null): number {
  if (!raw) return BS_FACTOR_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return BS_FACTOR_DEFAULT;
  return clampBsFactor(parsed);
}
