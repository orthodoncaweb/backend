import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCategoryDto,
  CreateSubcategoryDto,
  UpdateCategoryDto,
  UpdateSubcategoryDto,
} from './dto/category.dto';

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // elimina acentos/diacríticos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Lectura pública ----

  findAll() {
    return this.prisma.category.findMany({
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      include: {
        subcategories: { orderBy: [{ order: 'asc' }, { name: 'asc' }] },
      },
    });
  }

  async findBySlug(slug: string) {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      include: {
        subcategories: { orderBy: [{ order: 'asc' }, { name: 'asc' }] },
      },
    });
    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }
    return category;
  }

  // ---- Slugs únicos ----

  private async uniqueCategorySlug(name: string, excludeId?: string) {
    const base = slugify(name) || 'categoria';
    let slug = base;
    let i = 2;
    for (;;) {
      const existing = await this.prisma.category.findUnique({ where: { slug } });
      if (!existing || existing.id === excludeId) return slug;
      slug = `${base}-${i++}`;
    }
  }

  private async uniqueSubSlug(categoryId: string, name: string, excludeId?: string) {
    const base = slugify(name) || 'subcategoria';
    let slug = base;
    let i = 2;
    for (;;) {
      const existing = await this.prisma.subcategory.findUnique({
        where: { categoryId_slug: { categoryId, slug } },
      });
      if (!existing || existing.id === excludeId) return slug;
      slug = `${base}-${i++}`;
    }
  }

  // ---- Categorías (admin) ----

  async createCategory(dto: CreateCategoryDto) {
    const slug = await this.uniqueCategorySlug(dto.name);
    return this.prisma.category.create({
      data: {
        name: dto.name,
        slug,
        imageUrl: dto.imageUrl || null,
        order: dto.order ?? 0,
      },
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Categoría no encontrada');

    const slug = dto.name
      ? await this.uniqueCategorySlug(dto.name, id)
      : category.slug;

    return this.prisma.category.update({
      where: { id },
      data: {
        name: dto.name ?? category.name,
        slug,
        imageUrl: dto.imageUrl !== undefined ? dto.imageUrl || null : category.imageUrl,
        order: dto.order ?? category.order,
      },
    });
  }

  async deleteCategory(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Categoría no encontrada');
    await this.prisma.category.delete({ where: { id } });
    return { deleted: true };
  }

  // ---- Subcategorías (admin) ----

  async createSubcategory(dto: CreateSubcategoryDto) {
    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) throw new NotFoundException('Categoría no encontrada');

    const slug = await this.uniqueSubSlug(dto.categoryId, dto.name);
    return this.prisma.subcategory.create({
      data: {
        name: dto.name,
        slug,
        imageUrl: dto.imageUrl || null,
        order: dto.order ?? 0,
        categoryId: dto.categoryId,
      },
    });
  }

  async updateSubcategory(id: string, dto: UpdateSubcategoryDto) {
    const sub = await this.prisma.subcategory.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subcategoría no encontrada');

    const slug = dto.name
      ? await this.uniqueSubSlug(sub.categoryId, dto.name, id)
      : sub.slug;

    return this.prisma.subcategory.update({
      where: { id },
      data: {
        name: dto.name ?? sub.name,
        slug,
        imageUrl: dto.imageUrl !== undefined ? dto.imageUrl || null : sub.imageUrl,
        order: dto.order ?? sub.order,
      },
    });
  }

  async deleteSubcategory(id: string) {
    const sub = await this.prisma.subcategory.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subcategoría no encontrada');
    await this.prisma.subcategory.delete({ where: { id } });
    return { deleted: true };
  }
}
