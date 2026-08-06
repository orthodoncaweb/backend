import { NotFoundException } from '@nestjs/common';
import { FavoritesService } from './favorites.service';

// Test unitario plano: PrismaService mockeado como objeto con jest.fn().
describe('FavoritesService', () => {
  let service: FavoritesService;
  let prisma: {
    favorite: { findMany: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock };
    product: { findUnique: jest.Mock };
  };

  // Producto "de la BD": price es Decimal-like (number sirve, Number() lo normaliza).
  const buildProduct = (overrides: Partial<any> = {}) => ({
    id: 'p1',
    name: 'Bracket',
    price: 150,
    images: [],
    category: { id: 'c1', name: 'Cat', slug: 'cat' },
    subcategory: null,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      favorite: {
        findMany: jest.fn(),
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      product: { findUnique: jest.fn() },
    };
    service = new FavoritesService(prisma as any);
  });

  describe('listForCustomer', () => {
    it('serializa los productos favoritos: price a número y favorite=true', async () => {
      prisma.favorite.findMany.mockResolvedValue([
        { product: buildProduct({ id: 'p1', price: 150 }) },
        { product: buildProduct({ id: 'p2', price: 99.99 }) },
      ]);

      const result = await service.listForCustomer('cust-1');

      expect(prisma.favorite.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId: 'cust-1' },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({ id: 'p1', price: 150, favorite: true }),
      );
      expect(typeof result[1].price).toBe('number');
      expect(result[1].favorite).toBe(true);
    });

    it('devuelve [] cuando el cliente no tiene favoritos', async () => {
      prisma.favorite.findMany.mockResolvedValue([]);
      const result = await service.listForCustomer('cust-1');
      expect(result).toEqual([]);
    });
  });

  describe('add', () => {
    it('lanza NotFoundException si el producto no existe y no hace upsert', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.add('cust-1', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.favorite.upsert).not.toHaveBeenCalled();
    });

    it('hace upsert idempotente y devuelve { added: true }', async () => {
      prisma.product.findUnique.mockResolvedValue(buildProduct());

      const result = await service.add('cust-1', 'p1');

      expect(prisma.favorite.upsert).toHaveBeenCalledWith({
        where: { customerId_productId: { customerId: 'cust-1', productId: 'p1' } },
        create: { customerId: 'cust-1', productId: 'p1' },
        update: {},
      });
      expect(result).toEqual({ added: true });
    });
  });

  describe('remove', () => {
    it('elimina con deleteMany (no falla si no existía) y devuelve { removed: true }', async () => {
      const result = await service.remove('cust-1', 'p1');

      expect(prisma.favorite.deleteMany).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', productId: 'p1' },
      });
      expect(result).toEqual({ removed: true });
    });
  });
});
