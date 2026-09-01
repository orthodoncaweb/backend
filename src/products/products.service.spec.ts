import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';

// Mock plano de PrismaService: cada modelo expone los métodos usados por el
// servicio como jest.fn(). Cada test configura los resolved values.
function createPrismaMock() {
  return {
    product: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    category: {
      findUnique: jest.fn(),
    },
    subcategory: {
      findUnique: jest.fn(),
    },
  };
}

// Helper para construir un row de producto "tipo BD". price es Decimal-like
// (Number(...) lo normaliza igual), variants opcional.
function buildProduct(overrides: Partial<any> = {}): any {
  return {
    id: 'p1',
    name: 'Producto',
    sku: 'SKU-1',
    description: null,
    price: 100,
    images: [],
    categoryId: 'cat1',
    subcategoryId: null,
    hasVariants: false,
    attributes: [],
    createdAt: new Date('2026-01-01'),
    category: { id: 'cat1', name: 'Cat', slug: 'cat' },
    subcategory: null,
    ...overrides,
  };
}

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let revalidation: { revalidateProduct: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    revalidation = { revalidateProduct: jest.fn() };
    service = new ProductsService(prisma as any, revalidation as any);
  });

  // ---------------------------------------------------------------------------
  // effectivePrice / serialize vía findOne
  // ---------------------------------------------------------------------------
  describe('findOne (effectivePrice + serialize)', () => {
    it('producto simple: price = product.price y variants completas (vacío si no hay)', async () => {
      const product = buildProduct({ price: 100, hasVariants: false, variants: [] });
      prisma.product.findUnique.mockResolvedValue(product);

      const result = await service.findOne('p1');

      expect(result.price).toBe(100);
      expect(result.variants).toEqual([]);
      expect(result.attributes).toEqual([]);
      expect(prisma.product.findUnique).toHaveBeenCalledWith({
        where: { id: 'p1' },
        include: expect.objectContaining({
          variants: expect.anything(),
        }),
      });
    });

    it('producto con variantes: price = min(variants) y serialize incluye variantes completas', async () => {
      const product = buildProduct({
        price: 999, // product.price NO debe usarse cuando hay variantes cargadas
        hasVariants: true,
        variants: [
          { id: 'v1', sku: 's1', label: 'A', options: { color: 'rojo' }, price: 150, stock: 5, image: null },
          { id: 'v2', sku: 's2', label: 'B', options: { color: 'azul' }, price: 80, stock: 3, image: null },
          { id: 'v3', sku: 's3', label: 'C', options: { color: 'verde' }, price: 120, stock: 2, image: null },
        ],
      });
      prisma.product.findUnique.mockResolvedValue(product);

      const result = await service.findOne('p1');

      expect(result.price).toBe(80); // min de 150/80/120
      expect(result.variants).toHaveLength(3);
      expect(result.variants[1]).toEqual(
        expect.objectContaining({ id: 'v2', price: 80, options: { color: 'azul' } }),
      );
      // price de cada variante normalizado a número
      expect(result.variants.every((v: any) => typeof v.price === 'number')).toBe(true);
    });

    it('serialize: options malformadas en variante -> {} y attributes no-array -> []', async () => {
      const product = buildProduct({
        price: 50,
        hasVariants: true,
        attributes: 'no-es-array' as any,
        variants: [{ id: 'v1', sku: null, label: 'A', options: null, price: 70, stock: 0, image: null }],
      });
      prisma.product.findUnique.mockResolvedValue(product);

      const result = await service.findOne('p1');

      expect(result.attributes).toEqual([]);
      expect(result.variants[0].options).toEqual({});
      // hasVariants pero la variante única define el min
      expect(result.price).toBe(70);
    });

    it('lanza NotFoundException si el producto no existe', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // findAll / searchPaginated -> serialize con includeVariants=false
  // ---------------------------------------------------------------------------
  describe('findAll (listas: variants:[])', () => {
    it('devuelve variants:[] y price = product.price (las listas no cargan variantes)', async () => {
      // findAll usa productListInclude: la fila NO trae variantes desde la BD,
      // así que effectivePrice usa product.price (el "desde" ya guardado).
      const row = buildProduct({ price: 200, hasVariants: true });
      prisma.product.findMany.mockResolvedValue([row]);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].variants).toEqual([]);
      expect(result[0].price).toBe(200);
    });

    it('aplica filtros de category/subcategory/limit (take)', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      await service.findAll({ category: 'cat', subcategory: 'sub', limit: 5 });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            category: { is: { slug: 'cat' } },
            subcategory: { is: { slug: 'sub' } },
          },
          take: 5,
        }),
      );
    });
  });

  describe('searchPaginated (listas: variants:[])', () => {
    it('pagina, calcula totalPages y serializa con variants:[]', async () => {
      const rows = [buildProduct({ id: 'a', price: 10 }), buildProduct({ id: 'b', price: 20 })];
      prisma.product.findMany.mockResolvedValue(rows);
      prisma.product.count.mockResolvedValue(25);

      const result = await service.searchPaginated({ page: 2, limit: 10, sort: 'price_asc', search: 'foo' });

      expect(result.total).toBe(25);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(3); // ceil(25/10)
      expect(result.items.every((i: any) => i.variants.length === 0)).toBe(true);

      // skip = (page-1)*limit, orderBy price asc, where con search insensitive
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
          orderBy: { price: 'asc' },
          where: expect.objectContaining({
            name: { contains: 'foo', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('usa valores por defecto (page=1, limit=12, orderBy createdAt desc) con params inválidos', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      prisma.product.count.mockResolvedValue(0);

      const result = await service.searchPaginated({ page: 0, limit: -5 });

      expect(result.page).toBe(1);
      expect(result.limit).toBe(12);
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 12, orderBy: { createdAt: 'desc' } }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findRelated
  // ---------------------------------------------------------------------------
  describe('findRelated', () => {
    it('prioriza misma subcategoría y excluye el producto actual', async () => {
      const base = buildProduct({ id: 'p1', categoryId: 'cat1', subcategoryId: 'sub1' });
      prisma.product.findUnique.mockResolvedValue(base);

      // La subcategoría aporta las 4 que pide el limit -> no se consulta categoría.
      const subItems = [
        buildProduct({ id: 'r1' }),
        buildProduct({ id: 'r2' }),
        buildProduct({ id: 'r3' }),
        buildProduct({ id: 'r4' }),
      ];
      prisma.product.findMany.mockResolvedValueOnce(subItems);

      const result = await service.findRelated('p1', 4);

      expect(result.map((r: any) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
      // Solo una llamada a findMany (la de subcategoría).
      expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.product.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { subcategoryId: 'sub1', id: { notIn: ['p1'] } },
          take: 4,
        }),
      );
      // serialize de lista -> variants vacío
      expect(result[0].variants).toEqual([]);
    });

    it('completa con la categoría cuando la subcategoría no llena el limit y excluye los ya tomados', async () => {
      const base = buildProduct({ id: 'p1', categoryId: 'cat1', subcategoryId: 'sub1' });
      prisma.product.findUnique.mockResolvedValue(base);

      const subItems = [buildProduct({ id: 'r1' }), buildProduct({ id: 'r2' })];
      const catItems = [buildProduct({ id: 'r3' }), buildProduct({ id: 'r4' })];
      prisma.product.findMany
        .mockResolvedValueOnce(subItems) // subcategoría
        .mockResolvedValueOnce(catItems); // categoría (completa)

      const result = await service.findRelated('p1', 4);

      expect(result.map((r: any) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
      expect(prisma.product.findMany).toHaveBeenCalledTimes(2);

      // 1ª: subcategoría, excluye solo el actual
      expect(prisma.product.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { subcategoryId: 'sub1', id: { notIn: ['p1'] } },
          take: 4,
        }),
      );
      // 2ª: categoría, take = limit - ya recogidos (4-2=2), excluye actual + los de sub
      expect(prisma.product.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { categoryId: 'cat1', id: { notIn: ['p1', 'r1', 'r2'] } },
          take: 2,
        }),
      );
    });

    it('usa solo la categoría cuando el producto no tiene subcategoría', async () => {
      const base = buildProduct({ id: 'p1', categoryId: 'cat1', subcategoryId: null });
      prisma.product.findUnique.mockResolvedValue(base);

      const catItems = [buildProduct({ id: 'r1' }), buildProduct({ id: 'r2' })];
      prisma.product.findMany.mockResolvedValueOnce(catItems);

      const result = await service.findRelated('p1', 4);

      expect(result.map((r: any) => r.id)).toEqual(['r1', 'r2']);
      // Sin subcategoría: una sola consulta, la de categoría.
      expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.product.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { categoryId: 'cat1', id: { notIn: ['p1'] } },
          take: 4,
        }),
      );
    });

    it('lanza NotFoundException si el producto base no existe', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      await expect(service.findRelated('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    beforeEach(() => {
      // validateRelations: categoría válida por defecto.
      prisma.category.findUnique.mockResolvedValue({ id: 'cat1' });
    });

    it('lanza BadRequestException si hasVariants y variants vacío', async () => {
      const dto: any = {
        name: 'P',
        sku: 'SKU',
        categoryId: 'cat1',
        hasVariants: true,
        variants: [],
        price: 10,
      };
      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('producto variable: basePrice = min(variants) y crea variantes anidadas', async () => {
      const dto: any = {
        name: 'P var',
        sku: 'SKU-V',
        categoryId: 'cat1',
        hasVariants: true,
        price: 9999, // ignorado para variables
        variants: [
          { label: 'A', options: { t: '1' }, price: 30 },
          { label: 'B', options: { t: '2' }, price: 12 },
          { label: 'C', options: { t: '3' }, price: 45 },
        ],
      };
      const created = buildProduct({
        id: 'new',
        price: 12,
        hasVariants: true,
        variants: [
          { id: 'v1', label: 'A', options: { t: '1' }, price: 30, stock: 0, image: null, sku: null },
          { id: 'v2', label: 'B', options: { t: '2' }, price: 12, stock: 0, image: null, sku: null },
          { id: 'v3', label: 'C', options: { t: '3' }, price: 45, stock: 0, image: null, sku: null },
        ],
      });
      prisma.product.create.mockResolvedValue(created);

      const result = await service.create(dto);

      // price base persistido = min(30,12,45) = 12
      const callArg = prisma.product.create.mock.calls[0][0];
      expect(callArg.data.price).toBe(12);
      expect(callArg.data.hasVariants).toBe(true);
      expect(callArg.data.variants.create).toHaveLength(3);
      // serialize del resultado: min de variantes devueltas = 12
      expect(result.price).toBe(12);
      expect(result.variants).toHaveLength(3);
    });

    it('producto simple: basePrice = dto.price y sin variantes anidadas', async () => {
      const dto: any = {
        name: 'P simple',
        sku: 'SKU-S',
        categoryId: 'cat1',
        hasVariants: false,
        price: 77,
      };
      const created = buildProduct({ id: 'new', price: 77, hasVariants: false, variants: [] });
      prisma.product.create.mockResolvedValue(created);

      const result = await service.create(dto);

      const callArg = prisma.product.create.mock.calls[0][0];
      expect(callArg.data.price).toBe(77);
      expect(callArg.data.variants).toBeUndefined();
      expect(result.price).toBe(77);
      expect(result.variants).toEqual([]);
    });

    it('lanza BadRequestException si la categoría no existe (validateRelations)', async () => {
      prisma.category.findUnique.mockResolvedValue(null);
      const dto: any = { name: 'P', sku: 'SKU', categoryId: 'nope', price: 10 };
      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Purga de la caché del frontend
  // ---------------------------------------------------------------------------
  describe('revalidación del frontend', () => {
    it('remove purga la caché del producto borrado', async () => {
      prisma.product.findUnique.mockResolvedValue(buildProduct());
      prisma.product.delete.mockResolvedValue(undefined);

      await service.remove('p1');

      expect(revalidation.revalidateProduct).toHaveBeenCalledWith('p1');
    });

    it('remove no purga nada si el producto no existe', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(revalidation.revalidateProduct).not.toHaveBeenCalled();
    });
  });
});
