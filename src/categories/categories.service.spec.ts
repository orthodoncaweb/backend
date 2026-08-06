import { NotFoundException } from '@nestjs/common';
import { CategoriesService } from './categories.service';

// Test unitario plano: PrismaService mockeado como objeto con jest.fn().
describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: {
    category: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    subcategory: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      category: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn((args: any) => Promise.resolve({ id: 'new', ...args.data })),
        update: jest.fn((args: any) => Promise.resolve({ id: args.where.id, ...args.data })),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      subcategory: {
        findUnique: jest.fn(),
        create: jest.fn((args: any) => Promise.resolve({ id: 'new-sub', ...args.data })),
        update: jest.fn((args: any) => Promise.resolve({ id: args.where.id, ...args.data })),
        delete: jest.fn().mockResolvedValue(undefined),
      },
    };
    service = new CategoriesService(prisma as any);
  });

  describe('findBySlug', () => {
    it('devuelve la categoría cuando existe', async () => {
      const cat = { id: 'c1', slug: 'brackets', subcategories: [] };
      prisma.category.findUnique.mockResolvedValue(cat);

      const result = await service.findBySlug('brackets');

      expect(prisma.category.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { slug: 'brackets' } }),
      );
      expect(result).toBe(cat);
    });

    it('lanza NotFoundException cuando no existe', async () => {
      prisma.category.findUnique.mockResolvedValue(null);
      await expect(service.findBySlug('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createCategory (slug único + slugify)', () => {
    it('genera slug a partir del nombre (sin acentos) cuando no hay colisión', async () => {
      prisma.category.findUnique.mockResolvedValue(null); // slug libre

      const result = await service.createCategory({ name: 'Ortodoncia Estética' } as any);

      const arg = prisma.category.create.mock.calls[0][0];
      expect(arg.data.slug).toBe('ortodoncia-estetica');
      expect(arg.data.name).toBe('Ortodoncia Estética');
      // imageUrl ausente -> null, order ausente -> 0.
      expect(arg.data.imageUrl).toBeNull();
      expect(arg.data.order).toBe(0);
      expect(result.slug).toBe('ortodoncia-estetica');
    });

    it('añade sufijo numérico cuando el slug base ya existe', async () => {
      // Primera consulta: 'brackets' existe; segunda: 'brackets-2' libre.
      prisma.category.findUnique
        .mockResolvedValueOnce({ id: 'otra', slug: 'brackets' })
        .mockResolvedValueOnce(null);

      await service.createCategory({ name: 'Brackets' } as any);

      const arg = prisma.category.create.mock.calls[0][0];
      expect(arg.data.slug).toBe('brackets-2');
    });

    it('usa fallback "categoria" cuando el nombre no tiene caracteres válidos', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await service.createCategory({ name: '¡!!!' } as any);

      const arg = prisma.category.create.mock.calls[0][0];
      expect(arg.data.slug).toBe('categoria');
    });
  });

  describe('updateCategory', () => {
    it('lanza NotFoundException si la categoría no existe', async () => {
      prisma.category.findUnique.mockResolvedValue(null);
      await expect(
        service.updateCategory('missing', { name: 'X' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('regenera el slug cuando cambia el nombre (excluyéndose a sí misma)', async () => {
      const existing = { id: 'c1', name: 'Viejo', slug: 'viejo', imageUrl: null, order: 0 };
      // 1ª llamada: la categoría a actualizar. 2ª: comprobación de slug 'nuevo' -> la
      // misma categoría (excludeId === id) por lo que el slug se acepta sin sufijo.
      prisma.category.findUnique
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ id: 'c1', slug: 'nuevo' });

      await service.updateCategory('c1', { name: 'Nuevo' } as any);

      const arg = prisma.category.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'c1' });
      expect(arg.data.slug).toBe('nuevo');
      expect(arg.data.name).toBe('Nuevo');
    });

    it('conserva el slug actual cuando no se cambia el nombre', async () => {
      const existing = { id: 'c1', name: 'Cat', slug: 'cat', imageUrl: 'i.png', order: 2 };
      prisma.category.findUnique.mockResolvedValueOnce(existing);

      await service.updateCategory('c1', { order: 5 } as any);

      const arg = prisma.category.update.mock.calls[0][0];
      expect(arg.data.slug).toBe('cat');
      expect(arg.data.order).toBe(5);
      // imageUrl no enviado -> conserva el actual.
      expect(arg.data.imageUrl).toBe('i.png');
    });
  });

  describe('deleteCategory', () => {
    it('lanza NotFoundException si no existe', async () => {
      prisma.category.findUnique.mockResolvedValue(null);
      await expect(service.deleteCategory('x')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('elimina y devuelve { deleted: true }', async () => {
      prisma.category.findUnique.mockResolvedValue({ id: 'c1' });
      const result = await service.deleteCategory('c1');
      expect(prisma.category.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
      expect(result).toEqual({ deleted: true });
    });
  });

  describe('createSubcategory', () => {
    it('lanza NotFoundException si la categoría padre no existe', async () => {
      prisma.category.findUnique.mockResolvedValue(null);
      await expect(
        service.createSubcategory({ categoryId: 'c-missing', name: 'Sub' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.subcategory.create).not.toHaveBeenCalled();
    });

    it('crea la subcategoría con slug único dentro de la categoría', async () => {
      prisma.category.findUnique.mockResolvedValue({ id: 'c1' });
      prisma.subcategory.findUnique.mockResolvedValue(null); // slug libre

      const result = await service.createSubcategory({
        categoryId: 'c1',
        name: 'Tubos Bucales',
      } as any);

      const arg = prisma.subcategory.create.mock.calls[0][0];
      expect(arg.data.slug).toBe('tubos-bucales');
      expect(arg.data.categoryId).toBe('c1');
      expect(result.slug).toBe('tubos-bucales');
    });
  });

  describe('updateSubcategory / deleteSubcategory', () => {
    it('updateSubcategory lanza NotFoundException si no existe', async () => {
      prisma.subcategory.findUnique.mockResolvedValue(null);
      await expect(
        service.updateSubcategory('x', { name: 'Y' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deleteSubcategory elimina y devuelve { deleted: true }', async () => {
      prisma.subcategory.findUnique.mockResolvedValue({ id: 's1', categoryId: 'c1' });
      const result = await service.deleteSubcategory('s1');
      expect(prisma.subcategory.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
      expect(result).toEqual({ deleted: true });
    });
  });
});
