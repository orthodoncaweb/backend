import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PriceSyncService {
  private readonly logger = new Logger(PriceSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Se ejecuta una vez al día (3:00 AM).
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'price-sync' })
  async handleDailySync() {
    this.logger.log('Ejecutando verificación diaria de precios…');
    await this.syncPrices();
  }

  /**
   * Lee los productos y (cuando exista la API externa de precios) actualiza
   * los precios que estén desactualizados. Por ahora solo verifica/registra.
   */
  async syncPrices() {
    const products = await this.prisma.product.findMany({
      select: { id: true, sku: true, price: true },
    });

    // TODO: integrar la API externa de precios. Esqueleto:
    //   for (const p of products) {
    //     const precioActual = await this.obtenerPrecioExterno(p.sku);
    //     if (precioActual != null && Number(p.price) !== precioActual) {
    //       await this.prisma.product.update({
    //         where: { id: p.id },
    //         data: { price: precioActual },
    //       });
    //       updated++;
    //     }
    //   }

    this.logger.log(`Verificación de precios completada: ${products.length} productos.`);
    return { checked: products.length, updated: 0, ranAt: new Date().toISOString() };
  }
}
