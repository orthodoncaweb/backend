import { PriceSyncService } from './price-sync.service';

// Test unitario plano: PrismaService mockeado como objeto con jest.fn().
describe('PriceSyncService', () => {
  let service: PriceSyncService;
  let prisma: { product: { findMany: jest.Mock } };

  beforeEach(() => {
    prisma = { product: { findMany: jest.fn() } };
    service = new PriceSyncService(prisma as any);
  });

  describe('syncPrices', () => {
    it('cuenta los productos verificados y reporta updated=0 (sin API externa aún)', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 'p1', sku: 'A', price: 10 },
        { id: 'p2', sku: 'B', price: 20 },
        { id: 'p3', sku: 'C', price: 30 },
      ]);

      const result = await service.syncPrices();

      expect(prisma.product.findMany).toHaveBeenCalledWith({
        select: { id: true, sku: true, price: true },
      });
      expect(result.checked).toBe(3);
      expect(result.updated).toBe(0);
      expect(typeof result.ranAt).toBe('string');
    });

    it('reporta checked=0 cuando no hay productos', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      const result = await service.syncPrices();
      expect(result.checked).toBe(0);
      expect(result.updated).toBe(0);
    });
  });

  describe('handleDailySync', () => {
    it('delega en syncPrices', async () => {
      prisma.product.findMany.mockResolvedValue([{ id: 'p1', sku: 'A', price: 10 }]);
      const spy = jest.spyOn(service, 'syncPrices');

      await service.handleDailySync();

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
