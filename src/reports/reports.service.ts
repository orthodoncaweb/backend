import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private readonly exchangeRate: ExchangeRateService,
  ) {}

  // Tasa USD→VES actual (fallback para órdenes sin tasa histórica). 0 si falla.
  private async currentRate(): Promise<number> {
    try {
      return (await this.exchangeRate.getRate()).rate;
    } catch {
      return 0;
    }
  }

  // Convierte un total a USD usando la tasa histórica de la orden (o la actual).
  private toUsd(
    total: number,
    currency: string,
    stored: unknown,
    current: number,
  ): number {
    if (currency !== 'ves') return total;
    const r = stored ? Number(stored) : current;
    return r ? Number((total / r).toFixed(2)) : total;
  }

  // Escapa un valor para CSV: envuelve en comillas dobles y duplica comillas internas.
  private esc(value: unknown): string {
    const s = value === null || value === undefined ? '' : String(value);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  // Construye una línea CSV a partir de un arreglo de campos.
  private row(fields: unknown[]): string {
    return fields.map((f) => this.esc(f)).join(',');
  }

  // Formatea una fecha a ISO (o cadena vacía).
  private fmtDate(d: Date | null | undefined): string {
    return d ? new Date(d).toISOString() : '';
  }

  async salesCsv(): Promise<string> {
    const [orders, current] = await Promise.all([
      this.prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        include: { customer: true },
      }),
      this.currentRate(),
    ]);

    const lines: string[] = [];
    lines.push(
      this.row([
        'id',
        'fecha',
        'cliente',
        'email',
        'estado_pago',
        'estado_atencion',
        'metodo',
        'moneda',
        'total',
        'total_usd',
      ]),
    );

    for (const o of orders) {
      const cliente = o.customer
        ? `${o.customer.name} ${o.customer.lastName}`.trim()
        : (o.shippingName ?? '');
      const email = o.customer?.email ?? o.customerEmail ?? '';
      const total = Number(o.total);
      lines.push(
        this.row([
          o.id,
          this.fmtDate(o.createdAt),
          cliente,
          email,
          o.status,
          o.fulfillmentStatus,
          o.paymentMethod ?? '',
          o.currency,
          total,
          this.toUsd(total, o.currency, o.exchangeRateAtCreation, current),
        ]),
      );
    }

    return lines.join('\r\n') + '\r\n';
  }

  async customersCsv(): Promise<string> {
    const [customers, current] = await Promise.all([
      this.prisma.customer.findMany({
        orderBy: { createdAt: 'desc' },
        include: { orders: true },
      }),
      this.currentRate(),
    ]);

    const lines: string[] = [];
    lines.push(
      this.row([
        'id',
        'nombre',
        'apellido',
        'email',
        'especialidad',
        'telefono',
        'ciudad',
        'registrado',
        'pedidos',
        'total_comprado_usd',
      ]),
    );

    for (const c of customers) {
      // Solo dinero efectivamente pagado, normalizado a USD.
      const paid = c.orders.filter((o) => o.status === 'PAID');
      const totalComprado = paid.reduce(
        (acc, o) =>
          acc + this.toUsd(Number(o.total), o.currency, o.exchangeRateAtCreation, current),
        0,
      );
      lines.push(
        this.row([
          c.id,
          c.name,
          c.lastName,
          c.email,
          c.specialty ?? '',
          c.phone ?? '',
          c.city ?? '',
          this.fmtDate(c.createdAt),
          c.orders.length,
          totalComprado,
        ]),
      );
    }

    return lines.join('\r\n') + '\r\n';
  }
}
