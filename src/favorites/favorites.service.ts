import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const productInclude = {
  category: { select: { id: true, name: true, slug: true } },
  subcategory: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ProductInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  // Decimal de Prisma a número plano, y marca favorite=true.
  private serialize(product: ProductWithRelations) {
    return { ...product, price: Number(product.price), favorite: true };
  }

  // Lista los productos favoritos del cliente (más reciente primero).
  async listForCustomer(customerId: string) {
    const favorites = await this.prisma.favorite.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: { product: { include: productInclude } },
    });
    return favorites.map((f) => this.serialize(f.product));
  }

  // Agrega un favorito (idempotente gracias a @@unique).
  async add(customerId: string, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');

    await this.prisma.favorite.upsert({
      where: { customerId_productId: { customerId, productId } },
      create: { customerId, productId },
      update: {},
    });
    return { added: true };
  }

  // Elimina un favorito (no falla si no existía).
  async remove(customerId: string, productId: string) {
    await this.prisma.favorite.deleteMany({ where: { customerId, productId } });
    return { removed: true };
  }
}
