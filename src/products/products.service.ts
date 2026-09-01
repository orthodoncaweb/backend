import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RevalidationService } from '../revalidation/revalidation.service';
import {
  CreateProductDto,
  ProductVariantDto,
  UpdateProductDto,
} from './dto/product.dto';

const productInclude = {
  category: { select: { id: true, name: true, slug: true } },
  subcategory: { select: { id: true, name: true, slug: true } },
  variants: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ProductInclude;

// Para LISTAS: sin cargar variantes desde la BD. En los listados se descartan
// igual (serialize con includeVariants=false) y el precio "desde" ya está
// guardado en product.price (min de variantes al escribir).
const productListInclude = {
  category: { select: { id: true, name: true, slug: true } },
  subcategory: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ProductInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;
type ProductListRow = Prisma.ProductGetPayload<{ include: typeof productListInclude }>;
type AnyProductRow = ProductWithRelations | ProductListRow;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  // Precio efectivo: si tiene variantes cargadas -> mínimo ("desde"); si no -> price
  // del producto (que ya guarda ese mínimo, así las listas no necesitan las variantes).
  private effectivePrice(product: AnyProductRow): number {
    const variants = (product as ProductWithRelations).variants;
    if (product.hasVariants && variants && variants.length > 0) {
      return Math.min(...variants.map((v) => Number(v.price)));
    }
    return Number(product.price);
  }

  // Convierte los Decimal de Prisma a números planos para el JSON.
  // includeVariants=false (listas) o sin variantes cargadas -> variants: [].
  private serialize(product: AnyProductRow, includeVariants = true) {
    const variants = (product as ProductWithRelations).variants;
    return {
      ...product,
      price: this.effectivePrice(product),
      // Blindaje: si el JSON está malformado, devuelve [] para que el front no rompa.
      attributes: Array.isArray(product.attributes) ? product.attributes : [],
      variants:
        includeVariants && variants
          ? variants.map((v) => ({
              ...v,
              options: v.options && typeof v.options === 'object' ? v.options : {},
              price: Number(v.price),
            }))
          : [],
    };
  }

  private async validateRelations(categoryId: string, subcategoryId?: string | null) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new BadRequestException('La categoría seleccionada no existe');
    }
    if (subcategoryId) {
      const sub = await this.prisma.subcategory.findUnique({ where: { id: subcategoryId } });
      if (!sub) {
        throw new BadRequestException('La subcategoría seleccionada no existe');
      }
      if (sub.categoryId !== categoryId) {
        throw new BadRequestException('La subcategoría no pertenece a la categoría');
      }
    }
  }

  async findAll(filter?: { category?: string; subcategory?: string; limit?: number }) {
    const where: Prisma.ProductWhereInput = {};
    if (filter?.category) {
      where.category = { is: { slug: filter.category } };
    }
    if (filter?.subcategory) {
      where.subcategory = { is: { slug: filter.subcategory } };
    }
    const products = await this.prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: productListInclude,
      ...(filter?.limit && filter.limit > 0 ? { take: filter.limit } : {}),
    });
    // Lista: variants vacío para aligerar; price=min y attributes sí van.
    return products.map((p) => this.serialize(p, false));
  }

  // Búsqueda paginada con filtros y orden. GET /api/products/search
  async searchPaginated(params: {
    search?: string;
    sort?: string;
    page?: number;
    limit?: number;
    category?: string;
    subcategory?: string;
  }) {
    const page = params.page && params.page >= 1 ? params.page : 1;
    const limit = params.limit && params.limit >= 1 ? params.limit : 12;

    const where: Prisma.ProductWhereInput = {};
    if (params.search) {
      where.name = { contains: params.search, mode: 'insensitive' };
    }
    if (params.category) {
      where.category = { is: { slug: params.category } };
    }
    if (params.subcategory) {
      where.subcategory = { is: { slug: params.subcategory } };
    }

    // Para variables guardamos product.price = min(variants) al escribir,
    // así ordenar por price en la BD ya corresponde al precio efectivo "desde".
    let orderBy: Prisma.ProductOrderByWithRelationInput;
    if (params.sort === 'price_asc') {
      orderBy = { price: 'asc' };
    } else if (params.sort === 'price_desc') {
      orderBy = { price: 'desc' };
    } else {
      orderBy = { createdAt: 'desc' };
    }

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: productListInclude,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: items.map((p) => this.serialize(p, false)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Productos relacionados: prioriza la misma SUBCATEGORÍA (más afines) y, si
  // faltan, completa con la misma categoría. Siempre excluye el producto actual.
  async findRelated(id: string, limit = 4) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Producto no encontrado');

    const collected: ProductListRow[] = [];
    const excludeIds = [id];

    // 1) Misma subcategoría (los más afines), si el producto tiene una.
    // Se pasa una COPIA de excludeIds (no la referencia) para no aliasar el
    // arreglo mutable dentro del objeto de la consulta.
    if (product.subcategoryId) {
      const sameSub = await this.prisma.product.findMany({
        where: { subcategoryId: product.subcategoryId, id: { notIn: [...excludeIds] } },
        take: limit,
        include: productListInclude,
      });
      collected.push(...sameSub);
      excludeIds.push(...sameSub.map((p) => p.id));
    }

    // 2) Si faltan, completa con productos de la misma categoría.
    if (collected.length < limit) {
      const sameCat = await this.prisma.product.findMany({
        where: { categoryId: product.categoryId, id: { notIn: [...excludeIds] } },
        take: limit - collected.length,
        include: productListInclude,
      });
      collected.push(...sameCat);
    }

    return collected.map((p) => this.serialize(p, false));
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return this.serialize(product);
  }

  // Precio base mínimo entre las variantes recibidas.
  private minVariantPrice(variants: ProductVariantDto[]): number {
    return Math.min(...variants.map((v) => v.price));
  }

  // Datos de una variante para create/update anidado.
  private variantData(v: ProductVariantDto) {
    return {
      sku: v.sku ?? null,
      label: v.label,
      options: v.options as Prisma.InputJsonValue,
      price: v.price,
      stock: v.stock ?? 0,
      image: v.image ?? null,
    };
  }

  async create(dto: CreateProductDto) {
    await this.validateRelations(dto.categoryId, dto.subcategoryId);

    const hasVariants = dto.hasVariants ?? false;
    const variants = dto.variants ?? [];
    if (hasVariants && variants.length === 0) {
      throw new BadRequestException('Un producto con variantes requiere al menos una variante');
    }
    // Si es variable, el precio base es el mínimo de variantes ("desde").
    const basePrice = hasVariants ? this.minVariantPrice(variants) : dto.price;

    try {
      const product = await this.prisma.product.create({
        data: {
          name: dto.name,
          sku: dto.sku,
          description: dto.description ?? null,
          price: basePrice,
          images: dto.images ?? [],
          categoryId: dto.categoryId,
          subcategoryId: dto.subcategoryId || null,
          hasVariants,
          attributes: (dto.attributes ?? []) as unknown as Prisma.InputJsonValue,
          ...(hasVariants && variants.length > 0
            ? { variants: { create: variants.map((v) => this.variantData(v)) } }
            : {}),
        },
        include: productInclude,
      });
      // Purga la caché del frontend para que el producto aparezca de inmediato.
      this.revalidation.revalidateProduct(product.id);
      return this.serialize(product);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe un producto con ese SKU');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      include: { variants: true },
    });
    if (!existing) throw new NotFoundException('Producto no encontrado');

    const categoryId = dto.categoryId ?? existing.categoryId;
    const subcategoryId =
      dto.subcategoryId !== undefined ? dto.subcategoryId : existing.subcategoryId;
    await this.validateRelations(categoryId, subcategoryId);

    const hasVariants =
      dto.hasVariants !== undefined ? dto.hasVariants : existing.hasVariants;

    // ¿Hay que reconciliar variantes? Solo si llegan en el body.
    const variantsProvided = dto.variants !== undefined;
    const variants = dto.variants ?? [];
    if (hasVariants && variantsProvided && variants.length === 0) {
      throw new BadRequestException('Un producto con variantes requiere al menos una variante');
    }

    // Precio base: si es variable y vienen variantes -> min; si no, el del dto.
    let basePrice: number | undefined;
    if (hasVariants) {
      if (variantsProvided && variants.length > 0) {
        basePrice = this.minVariantPrice(variants);
      } else if (existing.variants.length > 0) {
        basePrice = Math.min(...existing.variants.map((v) => Number(v.price)));
      } else {
        basePrice = dto.price ?? undefined;
      }
    } else {
      basePrice = dto.price ?? undefined;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id },
          data: {
            name: dto.name ?? undefined,
            sku: dto.sku ?? undefined,
            description: dto.description !== undefined ? dto.description : undefined,
            price: basePrice,
            images: dto.images ?? undefined,
            categoryId: dto.categoryId ?? undefined,
            subcategoryId:
              dto.subcategoryId !== undefined ? dto.subcategoryId || null : undefined,
            hasVariants: dto.hasVariants !== undefined ? dto.hasVariants : undefined,
            attributes:
              dto.attributes !== undefined
                ? (dto.attributes as unknown as Prisma.InputJsonValue)
                : undefined,
          },
        });

        if (variantsProvided) {
          // Reconcilia: con id -> update; sin id -> create; faltantes -> delete.
          const incomingIds = variants.filter((v) => v.id).map((v) => v.id as string);
          await tx.productVariant.deleteMany({
            where: { productId: id, id: { notIn: incomingIds.length ? incomingIds : ['__none__'] } },
          });
          for (const v of variants) {
            if (v.id) {
              await tx.productVariant.update({
                where: { id: v.id },
                data: this.variantData(v),
              });
            } else {
              await tx.productVariant.create({
                data: { ...this.variantData(v), productId: id },
              });
            }
          }
        }
      });

      const product = await this.prisma.product.findUnique({
        where: { id },
        include: productInclude,
      });
      // Purga la caché del frontend: el cambio se ve sin esperar al TTL.
      this.revalidation.revalidateProduct(id);
      return this.serialize(product as ProductWithRelations);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe un producto con ese SKU');
      }
      throw e;
    }
  }

  async remove(id: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Producto no encontrado');
    await this.prisma.product.delete({ where: { id } });
    this.revalidation.revalidateProduct(id);
    return { deleted: true };
  }
}
