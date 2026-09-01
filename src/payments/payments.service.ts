import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, OrderStatus, FulfillmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { CheckoutDto } from './dto/checkout.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';

// Etiquetas legibles de los métodos de pago (Stripe deshabilitado temporalmente).
const WHATSAPP_METHOD_LABELS: Record<string, string> = {
  transferencia_usd: 'Transferencia USD',
  zelle: 'Zelle',
  transferencia_bs: 'Transferencia Bs',
  pago_movil: 'Pago móvil',
};
// Métodos cuyo pago se cotiza en dólares; el resto en bolívares.
const USD_WHATSAPP_METHODS = ['transferencia_usd', 'zelle'];

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly exchangeRate: ExchangeRateService,
  ) {}

  // Resuelve un ítem del carrito contra la BD: valida producto/variante,
  // calcula el precio real (variante o producto) y los datos del OrderItem.
  // No se confía en el precio enviado por el cliente.
  private resolveLineItem(
    item: { productId: string; variantId?: string; quantity: number },
    products: Array<{
      id: string;
      name: string;
      price: unknown;
      images: string[];
      hasVariants: boolean;
      variants: Array<{ id: string; label: string; price: unknown; image: string | null }>;
    }>,
  ) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) {
      throw new BadRequestException(`Producto no encontrado: ${item.productId}`);
    }

    if (product.hasVariants) {
      if (!item.variantId) {
        throw new BadRequestException(
          `Selecciona una variante de "${product.name}"`,
        );
      }
      const variant = product.variants.find((v) => v.id === item.variantId);
      if (!variant) {
        throw new BadRequestException(
          `Variante no válida para "${product.name}"`,
        );
      }
      return {
        product,
        quantity: item.quantity,
        unitPrice: Number(variant.price),
        variantId: variant.id,
        variantLabel: variant.label,
        image: variant.image ?? product.images[0] ?? null,
      };
    }

    return {
      product,
      quantity: item.quantity,
      unitPrice: Number(product.price),
      variantId: null as string | null,
      variantLabel: null as string | null,
      image: product.images[0] ?? null,
    };
  }

  // Crea un pedido (PENDING, pago en bolívares) y devuelve el enlace de WhatsApp
  // con el mensaje del pedido prellenado. El número se configura en el panel.
  async createWhatsappOrder(dto: CheckoutDto, customerId?: string) {
    const ids = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      include: { variants: true },
    });

    const lineItems = dto.items.map((item) => this.resolveLineItem(item, products));
    if (!lineItems.length) throw new BadRequestException('El carrito está vacío');

    const total = lineItems.reduce((sum, li) => sum + li.unitPrice * li.quantity, 0);

    const customer = customerId
      ? await this.prisma.customer.findUnique({ where: { id: customerId } })
      : null;

    const shipping = dto.shipping ?? {};
    const shipName =
      shipping.name ?? (customer ? `${customer.name} ${customer.lastName}` : null);
    const shipPhone = shipping.phone ?? customer?.phone ?? null;
    const shipAddress =
      shipping.address ?? customer?.shippingAddress ?? customer?.address ?? null;
    const shipCity = shipping.city ?? customer?.shippingCity ?? customer?.city ?? null;

    // Número de WhatsApp configurado en el panel (solo dígitos). Se valida antes
    // de crear el pedido para no dejar órdenes huérfanas.
    const numberRaw = await this.settings.getWhatsapp();
    const digits = (numberRaw ?? '').replace(/\D/g, '');
    if (!digits) {
      throw new BadRequestException(
        'El número de WhatsApp no está configurado en el panel administrativo.',
      );
    }

    // Método de pago elegido (Stripe deshabilitado): define la moneda del pedido.
    const method = dto.paymentMethod ?? 'transferencia_bs';
    const isUsd = USD_WHATSAPP_METHODS.includes(method);
    const methodLabel = WHATSAPP_METHOD_LABELS[method] ?? 'Pago';

    // Tasa de cambio: SOLO se necesita para los métodos en bolívares. Se usa
    // bsRate (tasa oficial x factor de conversión configurado en el panel) para
    // que el monto cobrado coincida con el que ve el cliente en la tienda. Si la
    // fuente falla, NO usamos 1:1 silenciosamente (precios gravemente errados):
    // abortamos con un error claro en vez de registrar una orden mal cotizada.
    let rate = 1;
    if (!isUsd) {
      try {
        rate = (await this.exchangeRate.getRate()).bsRate;
      } catch {
        rate = 0;
      }
      if (!rate || rate <= 0) {
        throw new BadRequestException(
          'No se pudo obtener la tasa de cambio para calcular el precio en bolívares. ' +
            'Intenta de nuevo en unos minutos o elige un método de pago en dólares.',
        );
      }
    }
    const toBs = (usd: number) => Number((usd * rate).toFixed(2));
    const bs = (usd: number) =>
      toBs(usd).toLocaleString('es-VE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    // Monto a GUARDAR en la orden (USD crudo o Bs según el método).
    const amount = (usd: number) => (isUsd ? Number(usd.toFixed(2)) : toBs(usd));
    // Texto del monto en el mensaje (con el símbolo de la moneda del método).
    const money = (usd: number) =>
      isUsd
        ? `$${usd.toLocaleString('es-VE', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`
        : `Bs. ${bs(usd)}`;

    const order = await this.prisma.order.create({
      data: {
        status: 'PENDING',
        total: amount(total),
        currency: isUsd ? 'usd' : 'ves',
        // Tasa histórica solo para órdenes en Bs (las USD no se convierten).
        exchangeRateAtCreation: isUsd ? null : rate,
        paymentMethod: method,
        customerEmail: dto.email ?? customer?.email ?? null,
        customerId: customerId ?? null,
        shippingName: shipName,
        shippingPhone: shipPhone,
        shippingIdDocument: shipping.idDocument ?? customer?.idDocument ?? null,
        shippingAddress: shipAddress,
        shippingCity: shipCity,
        shippingNotes: shipping.notes ?? null,
        billingAddress: customer?.billingAddress ?? null,
        billingCity: customer?.billingCity ?? null,
        billingState: customer?.billingState ?? null,
        items: {
          create: lineItems.map((li) => ({
            productId: li.product.id,
            variantId: li.variantId,
            variantLabel: li.variantLabel,
            name: li.product.name + (li.variantLabel ? ' - ' + li.variantLabel : ''),
            image: li.image,
            unitPrice: amount(li.unitPrice),
            quantity: li.quantity,
          })),
        },
      },
    });

    const now = new Date();
    const fecha = now.toLocaleDateString('es-VE');
    const hora = now.toLocaleTimeString('es-VE', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const lines: string[] = [];
    lines.push('Hola, vengo de Orthodonca');
    lines.push(`Pedido #${order.id.slice(-8).toUpperCase()}`);
    lines.push(`${fecha} - ${hora}`);
    lines.push('');
    lines.push(`Nombre: ${shipName ?? '-'}`);
    if (shipPhone) lines.push(`Teléfono: ${shipPhone}`);
    if (shipAddress) {
      lines.push(`Dirección de envío: ${shipAddress}${shipCity ? ', ' + shipCity : ''}`);
    }
    const billParts = [
      customer?.billingAddress,
      customer?.billingCity,
      customer?.billingState,
    ].filter(Boolean);
    if (billParts.length) {
      lines.push(`Dirección de facturación: ${billParts.join(', ')}`);
    }
    lines.push('');
    lines.push('Productos');
    for (const li of lineItems) {
      const nombre = li.product.name + (li.variantLabel ? ' - ' + li.variantLabel : '');
      lines.push(`X${li.quantity} ${nombre} - ${money(li.unitPrice * li.quantity)}`);
    }
    lines.push('');
    lines.push(`Subtotal: ${money(total)}`);
    lines.push(`Total: ${money(total)}`);
    lines.push('');
    lines.push('Pago');
    lines.push('Estado del pago: No pagado');
    lines.push(`Total a pagar: ${money(total)}`);
    lines.push(`Método: ${methodLabel}`);
    lines.push('');
    lines.push('Envíanos este mensaje y coordinamos el pago. ¡Gracias!');

    const message = lines.join('\n');
    const whatsappUrl = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;

    // Correos del pedido (el servicio de correo nunca lanza: no rompe el flujo).
    const shortId = order.id.slice(-8).toUpperCase();
    const currency = isUsd ? 'usd' : 'ves';
    const emailItems = lineItems.map((li) => ({
      name: li.product.name + (li.variantLabel ? ' - ' + li.variantLabel : ''),
      quantity: li.quantity,
      unitPrice: amount(li.unitPrice),
    }));
    const buyerEmail = dto.email ?? customer?.email ?? null;
    if (buyerEmail) {
      await this.mail.sendOrderConfirmation(buyerEmail, {
        id: shortId,
        total: amount(total),
        currency,
        items: emailItems,
      });
    }
    const adminEmail = this.config.get<string>('ADMIN_EMAIL');
    if (adminEmail) {
      await this.mail.sendNewOrderToAdmin(adminEmail, {
        id: shortId,
        total: amount(total),
        currency,
        items: emailItems,
        customerName: shipName ?? buyerEmail ?? 'Cliente',
        customerEmail: buyerEmail ?? '-',
        paymentMethod: methodLabel,
      });
    }

    return { whatsappUrl, orderId: order.id };
  }

  async createCheckoutSession(dto: CheckoutDto, customerId?: string) {
    const ids = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      include: { variants: true },
    });

    // Construye los ítems con precios REALES de la BD (no se confía en el cliente).
    const lineItems = dto.items.map((item) => this.resolveLineItem(item, products));

    const total = lineItems.reduce((sum, li) => sum + li.unitPrice * li.quantity, 0);

    const customer = customerId
      ? await this.prisma.customer.findUnique({ where: { id: customerId } })
      : null;
    const ship = dto.shipping ?? {};

    // Crea la orden en estado PENDING (toma envío/facturación del perfil del cliente).
    const order = await this.prisma.order.create({
      data: {
        status: 'PENDING',
        total,
        currency: 'usd',
        exchangeRateAtCreation: null,
        paymentMethod: 'card',
        customerEmail: dto.email ?? customer?.email ?? null,
        customerId: customerId ?? null,
        shippingName: ship.name ?? (customer ? `${customer.name} ${customer.lastName}` : null),
        shippingPhone: ship.phone ?? customer?.phone ?? null,
        shippingIdDocument: ship.idDocument ?? customer?.idDocument ?? null,
        shippingAddress: ship.address ?? customer?.shippingAddress ?? customer?.address ?? null,
        shippingCity: ship.city ?? customer?.shippingCity ?? customer?.city ?? null,
        shippingNotes: ship.notes ?? null,
        billingAddress: customer?.billingAddress ?? null,
        billingCity: customer?.billingCity ?? null,
        billingState: customer?.billingState ?? null,
        items: {
          create: lineItems.map((li) => ({
            productId: li.product.id,
            variantId: li.variantId,
            variantLabel: li.variantLabel,
            name: li.product.name + (li.variantLabel ? ' - ' + li.variantLabel : ''),
            image: li.image,
            unitPrice: li.unitPrice,
            quantity: li.quantity,
          })),
        },
      },
    });

    const successUrl =
      this.config.get<string>('STRIPE_SUCCESS_URL') ??
      'http://localhost:3000/checkout/exito';
    const cancelUrl =
      this.config.get<string>('STRIPE_CANCEL_URL') ??
      'http://localhost:3000/checkout/cancelado';

    let session;
    try {
      session = await this.stripe.getClient().checkout.sessions.create({
        mode: 'payment',
        line_items: lineItems.map((li) => ({
          quantity: li.quantity,
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(li.unitPrice * 100),
            product_data: {
              name: li.product.name + (li.variantLabel ? ' - ' + li.variantLabel : ''),
            },
          },
        })),
        success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl,
        customer_email: dto.email || undefined,
        metadata: { orderId: order.id },
      });
    } catch (err) {
      // Si falla la creación de la sesión, no dejamos la orden huérfana.
      await this.prisma.order.delete({ where: { id: order.id } }).catch(() => undefined);
      throw err;
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { stripeSessionId: session.id },
    });

    return { url: session.url, orderId: order.id };
  }

  async handleWebhook(rawBody: Buffer, signature: string | undefined) {
    const secret = this.stripe.webhookSecret;
    if (!secret || !signature) {
      throw new BadRequestException('Webhook no configurado');
    }

    const stripe = this.stripe.getClient();
    let event: ReturnType<typeof stripe.webhooks.constructEvent>;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      this.logger.error(`Firma de webhook inválida: ${(err as Error).message}`);
      throw new BadRequestException('Firma de webhook inválida');
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as {
        metadata?: Record<string, string> | null;
        customer_details?: { email?: string | null } | null;
      };
      const orderId = session.metadata?.orderId;
      if (orderId) {
        const order = await this.prisma.order.update({
          where: { id: orderId },
          data: {
            status: 'PAID',
            customerEmail: session.customer_details?.email ?? undefined,
          },
          include: { items: true },
        });
        this.logger.log(`Orden ${orderId} marcada como PAGADA.`);
        await this.sendConfirmationMail(order);
      }
    }

    return { received: true };
  }

  // Confirma una orden consultando la sesión directamente a Stripe (no requiere
  // webhook). Útil para confirmar al volver de la página de pago.
  async confirmSession(sessionId: string) {
    const stripe = this.stripe.getClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === 'paid') {
      const order = await this.prisma.order
        .update({
          where: { stripeSessionId: sessionId },
          data: {
            status: 'PAID',
            customerEmail: session.customer_details?.email ?? undefined,
          },
          include: { items: true },
        })
        .catch(() => undefined);
      if (order) {
        await this.sendConfirmationMail(order);
      }
      return { paid: true };
    }

    return { paid: false, status: session.payment_status };
  }

  // Envía el correo de confirmación de pedido sin romper el flujo de pago.
  private async sendConfirmationMail(order: {
    customerEmail: string | null;
    id: string;
    total: unknown;
    items: { name: string; quantity: number; unitPrice: unknown }[];
  }): Promise<void> {
    if (!order.customerEmail) return;
    try {
      await this.mail.sendOrderConfirmation(order.customerEmail, {
        id: order.id,
        total: Number(order.total),
        items: order.items.map((it) => ({
          name: it.name,
          quantity: it.quantity,
          unitPrice: Number(it.unitPrice),
        })),
      });
    } catch (err) {
      this.logger.error(
        `No se pudo enviar el correo de confirmación de la orden ${order.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private serializeOrder<
    T extends { total: unknown; items: { unitPrice: unknown }[] },
  >(order: T) {
    return {
      ...order,
      total: Number(order.total),
      items: order.items.map((it) => ({ ...it, unitPrice: Number(it.unitPrice) })),
    };
  }

  // Listado paginado con filtros (estado de pago/atención, búsqueda) + stats
  // GLOBALES (no filtradas) para los KPIs del panel. Evita cargar todo en memoria.
  async findAllOrders(params?: {
    page?: number;
    limit?: number;
    status?: string;
    fulfillmentStatus?: string;
    search?: string;
  }) {
    const page = params?.page && params.page >= 1 ? params.page : 1;
    const limit = params?.limit && params.limit >= 1 ? Math.min(params.limit, 100) : 20;

    const where: Prisma.OrderWhereInput = {};
    if (params?.status) where.status = params.status as OrderStatus;
    if (params?.fulfillmentStatus) {
      where.fulfillmentStatus = params.fulfillmentStatus as FulfillmentStatus;
    }
    const s = params?.search?.trim();
    if (s) {
      where.OR = [
        { id: { contains: s, mode: 'insensitive' } },
        { customerEmail: { contains: s, mode: 'insensitive' } },
        { shippingName: { contains: s, mode: 'insensitive' } },
        {
          customer: {
            is: {
              OR: [
                { name: { contains: s, mode: 'insensitive' } },
                { lastName: { contains: s, mode: 'insensitive' } },
                { email: { contains: s, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    const [items, total, grandTotal, pending, paid, toShip] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          items: true,
          customer: { select: { id: true, name: true, lastName: true, email: true } },
        },
      }),
      this.prisma.order.count({ where }),
      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: 'PENDING' } }),
      this.prisma.order.count({ where: { status: 'PAID' } }),
      this.prisma.order.count({
        where: { status: 'PAID', fulfillmentStatus: { not: 'ENVIADO' } },
      }),
    ]);

    return {
      items: items.map((o) => this.serializeOrder(o)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      stats: { total: grandTotal, pending, paid, toShip },
    };
  }

  async findOrder(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        customer: {
          select: { id: true, name: true, lastName: true, email: true, specialty: true },
        },
      },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return this.serializeOrder(order);
  }

  // Compatibilidad: actualiza solo el estado de atención.
  async updateFulfillment(id: string, fulfillmentStatus: 'RECIBIDO' | 'EN_PREPARACION' | 'ENVIADO') {
    return this.updateOrder(id, { fulfillmentStatus });
  }

  // Actualiza los campos provistos de la orden (estado de pago, atención,
  // seguimiento y notas). Si pasa a ENVIADO, dispara el correo de envío.
  async updateOrder(id: string, dto: UpdateOrderStatusDto) {
    const exists = await this.prisma.order.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Pedido no encontrado');

    const data: {
      fulfillmentStatus?: UpdateOrderStatusDto['fulfillmentStatus'];
      status?: UpdateOrderStatusDto['status'];
      trackingNumber?: string;
      adminNotes?: string;
    } = {};
    if (dto.fulfillmentStatus !== undefined) data.fulfillmentStatus = dto.fulfillmentStatus;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.trackingNumber !== undefined) data.trackingNumber = dto.trackingNumber;
    if (dto.adminNotes !== undefined) data.adminNotes = dto.adminNotes;

    const order = await this.prisma.order.update({
      where: { id },
      data,
      include: {
        items: true,
        customer: {
          select: { id: true, name: true, lastName: true, email: true, specialty: true },
        },
      },
    });

    // Correo de pedido enviado (no rompe el flujo).
    if (dto.fulfillmentStatus === 'ENVIADO' && order.customerEmail) {
      try {
        await this.mail.sendOrderShipped(
          order.customerEmail,
          {
            id: order.id,
            total: Number(order.total),
            items: order.items.map((it) => ({
              name: it.name,
              quantity: it.quantity,
              unitPrice: Number(it.unitPrice),
            })),
          },
          order.trackingNumber ?? undefined,
        );
      } catch (err) {
        this.logger.error(
          `No se pudo enviar el correo de envío de la orden ${order.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return this.serializeOrder(order);
  }

  async findCustomerOrders(customerId: string) {
    const orders = await this.prisma.order.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
    return orders.map((o) => this.serializeOrder(o));
  }
}
