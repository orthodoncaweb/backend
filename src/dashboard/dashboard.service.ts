import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exchangeRate: ExchangeRateService,
  ) {}

  async getStats() {
    // Inicio del mes actual.
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let rate = 1;
    try {
      rate = (await this.exchangeRate.getRate()).rate;
    } catch {
      rate = 1;
    }

    const [paidOrders, ordersCount, productsCount, customersCount, recent] =
      await Promise.all([
        this.prisma.order.findMany({
          where: { status: 'PAID', createdAt: { gte: startOfMonth } },
          select: { total: true, currency: true, exchangeRateAtCreation: true },
        }),
        this.prisma.order.count(),
        this.prisma.product.count(),
        this.prisma.customer.count(),
        this.prisma.order.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { customer: true },
        }),
      ]);

    // Suma en USD. Las órdenes en bolívares se convierten con la tasa HISTÓRICA
    // guardada al crearlas (no la actual); si falta (órdenes viejas), usa la actual.
    const salesThisMonth = paidOrders.reduce((sum, o) => {
      const total = Number(o.total);
      if (o.currency !== 'ves') return sum + total;
      const r = o.exchangeRateAtCreation ? Number(o.exchangeRateAtCreation) : rate;
      return sum + (r ? total / r : total);
    }, 0);

    const recentOrders = recent.map((o) => {
      let customerName = 'Invitado';
      if (o.customer) {
        customerName = `${o.customer.name} ${o.customer.lastName}`.trim();
      } else if (o.customerEmail) {
        customerName = o.customerEmail;
      }
      return {
        id: o.id,
        customerName,
        total: Number(o.total),
        currency: o.currency,
        status: o.status,
        fulfillmentStatus: o.fulfillmentStatus,
        createdAt: o.createdAt,
      };
    });

    return {
      salesThisMonth: Number(salesThisMonth.toFixed(2)),
      ordersCount,
      productsCount,
      customersCount,
      recentOrders,
    };
  }
}
