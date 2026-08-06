import { ServiceUnavailableException } from '@nestjs/common';
import { ExchangeRateService } from './exchange-rate.service';

// Test unitario plano: PrismaService mockeado y global.fetch mockeado.
describe('ExchangeRateService', () => {
  let service: ExchangeRateService;
  let prisma: {
    setting: { findUnique: jest.Mock; upsert: jest.Mock };
    exchangeRateHistory: { upsert: jest.Mock; findMany: jest.Mock };
  };

  // Respuesta tipo dolarapi (lista con fuente oficial/paralelo).
  const dolarOk = [
    { fuente: 'oficial', promedio: 40, fechaActualizacion: '2026-06-24T00:00:00.000Z' },
    { fuente: 'paralelo', promedio: 45, fechaActualizacion: '2026-06-24T00:00:00.000Z' },
  ];

  // Helper para construir una Response-like de fetch.
  const jsonResponse = (data: any, ok = true) =>
    Promise.resolve({ ok, json: () => Promise.resolve(data) } as any);

  beforeEach(() => {
    prisma = {
      setting: { findUnique: jest.fn(), upsert: jest.fn().mockResolvedValue(undefined) },
      exchangeRateHistory: {
        upsert: jest.fn().mockResolvedValue(undefined),
        findMany: jest.fn(),
      },
    };
    service = new ExchangeRateService(prisma as any);
    global.fetch = jest.fn() as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getType', () => {
    it('devuelve EUR cuando el setting vale "EUR"', async () => {
      prisma.setting.findUnique.mockResolvedValue({ value: 'EUR' });
      expect(await service.getType()).toBe('EUR');
    });

    it('devuelve USD por defecto (setting ausente o distinto)', async () => {
      prisma.setting.findUnique.mockResolvedValue(null);
      expect(await service.getType()).toBe('USD');
    });
  });

  describe('getRate (tipo USD)', () => {
    it('obtiene la tasa oficial de dolarapi y la cachea', async () => {
      prisma.setting.findUnique.mockResolvedValue({ value: 'USD' });
      (global.fetch as jest.Mock).mockReturnValue(jsonResponse(dolarOk));

      const info = await service.getRate();

      expect(info.type).toBe('USD');
      expect(info.baseCurrency).toBe('USD');
      expect(info.baseSymbol).toBe('$');
      expect(info.rate).toBe(40);
      expect(info.usdVes).toBe(40);
      // strip() elimina fetchedAt del objeto devuelto.
      expect((info as any).fetchedAt).toBeUndefined();
    });

    it('usa la caché en la 2ª llamada (no vuelve a hacer fetch del dólar)', async () => {
      prisma.setting.findUnique.mockResolvedValue({ value: 'USD' });
      (global.fetch as jest.Mock).mockReturnValue(jsonResponse(dolarOk));

      await service.getRate();
      const fetchCallsAfterFirst = (global.fetch as jest.Mock).mock.calls.length;
      await service.getRate();

      // getType vuelve a consultar el setting, pero fetch del dólar NO se repite.
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(fetchCallsAfterFirst);
    });
  });

  describe('getRate (tipo EUR)', () => {
    it('multiplica la tasa oficial por EUR/USD', async () => {
      prisma.setting.findUnique.mockResolvedValue({ value: 'EUR' });
      (global.fetch as jest.Mock)
        .mockReturnValueOnce(jsonResponse(dolarOk)) // fetchDolar
        .mockReturnValueOnce(jsonResponse({ rates: { USD: 1.1 } })); // fetchEurUsd

      const info = await service.getRate();

      expect(info.type).toBe('EUR');
      expect(info.baseCurrency).toBe('EUR');
      expect(info.baseSymbol).toBe('€');
      // 1.1 * 40 = 44.
      expect(info.rate).toBe(44);
      expect(info.eurUsd).toBe(1.1);
      expect(info.usdVes).toBe(40);
    });
  });

  describe('getRate (errores)', () => {
    it('lanza ServiceUnavailableException si dolarapi falla y no hay caché', async () => {
      prisma.setting.findUnique.mockResolvedValue({ value: 'USD' });
      (global.fetch as jest.Mock).mockReturnValue(jsonResponse(null, false));

      await expect(service.getRate()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('devuelve la caché previa si una llamada posterior falla', async () => {
      prisma.setting.findUnique.mockResolvedValue({ value: 'USD' });
      (global.fetch as jest.Mock).mockReturnValueOnce(jsonResponse(dolarOk));
      const first = await service.getRate();

      // Forzamos expiración de la caché manipulando fetchedAt vía el siguiente truco:
      // cambiamos el tipo para invalidar la caché y hacemos fallar el fetch.
      prisma.setting.findUnique.mockResolvedValue({ value: 'EUR' });
      (global.fetch as jest.Mock).mockReturnValue(jsonResponse(null, false));

      const second = await service.getRate();
      // Devuelve la caché anterior (USD) en lugar de lanzar.
      expect(second.rate).toBe(first.rate);
    });
  });

  describe('setType', () => {
    it('hace upsert del setting, limpia la caché y devuelve la nueva tasa', async () => {
      prisma.setting.findUnique.mockResolvedValue({ value: 'USD' });
      (global.fetch as jest.Mock).mockReturnValue(jsonResponse(dolarOk));

      const info = await service.setType('USD');

      expect(prisma.setting.upsert).toHaveBeenCalledWith({
        where: { key: 'exchange_rate_type' },
        update: { value: 'USD' },
        create: { key: 'exchange_rate_type', value: 'USD' },
      });
      expect(info.type).toBe('USD');
    });
  });

  describe('getHistory', () => {
    it('serializa los Decimals a número y null cuando corresponde', async () => {
      prisma.exchangeRateHistory.findMany.mockResolvedValue([
        {
          id: 'h1',
          day: '2026-06-24',
          usdVesOficial: 40,
          usdVesParalelo: 45,
          eurUsd: null,
          createdAt: new Date('2026-06-24'),
        },
      ]);

      const result = await service.getHistory(10);

      expect(prisma.exchangeRateHistory.findMany).toHaveBeenCalledWith({
        orderBy: { day: 'desc' },
        take: 10,
      });
      expect(result[0]).toEqual(
        expect.objectContaining({
          usdVesOficial: 40,
          usdVesParalelo: 45,
          eurUsd: null,
        }),
      );
      expect(typeof result[0].usdVesOficial).toBe('number');
    });
  });

  describe('recordDailyRate', () => {
    it('hace upsert del día con la tasa oficial y paralela', async () => {
      (global.fetch as jest.Mock)
        .mockReturnValueOnce(jsonResponse(dolarOk)) // fetchDolar
        .mockReturnValueOnce(jsonResponse({ rates: { USD: 1.1 } })); // fetchEurUsd

      const result = await service.recordDailyRate();

      expect(prisma.exchangeRateHistory.upsert).toHaveBeenCalledTimes(1);
      const arg = prisma.exchangeRateHistory.upsert.mock.calls[0][0];
      expect(arg.create.usdVesOficial).toBe(40);
      expect(arg.create.usdVesParalelo).toBe(45);
      expect(result.usdVesOficial).toBe(40);
    });
  });
});
