import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

/**
 * Tests unitarios planos de PaymentsService.createWhatsappOrder.
 *
 * Solo se cubre la VALIDACIÓN de createWhatsappOrder (variantes, tasa de
 * cambio en bolívares y rama en USD). Se instancia el servicio con todas las
 * dependencias mockeadas como objetos con jest.fn().
 */
describe('PaymentsService - createWhatsappOrder', () => {
  let service: PaymentsService;

  // Mocks de dependencias.
  let prisma: {
    product: { findMany: jest.Mock };
    customer: { findUnique: jest.Mock };
    order: { create: jest.Mock };
  };
  let stripe: Record<string, jest.Mock>;
  let config: { get: jest.Mock };
  let mail: {
    sendOrderConfirmation: jest.Mock;
    sendNewOrderToAdmin: jest.Mock;
  };
  let settings: { getWhatsapp: jest.Mock };
  let exchangeRate: { getRate: jest.Mock };

  // Producto simple (sin variantes) y producto con variantes.
  const simpleProduct = {
    id: 'prod-simple',
    name: 'Cepillo',
    price: 10,
    images: ['img-simple.jpg'],
    hasVariants: false,
    variants: [],
  };
  const variantProduct = {
    id: 'prod-variant',
    name: 'Brackets',
    price: 0,
    images: ['img-variant.jpg'],
    hasVariants: true,
    variants: [
      { id: 'var-1', label: 'Metálico', price: 25, image: 'img-var-1.jpg' },
    ],
  };

  beforeEach(() => {
    prisma = {
      product: { findMany: jest.fn() },
      customer: { findUnique: jest.fn().mockResolvedValue(null) },
      order: { create: jest.fn().mockResolvedValue({ id: 'ckorder123456789' }) },
    };
    stripe = {};
    config = { get: jest.fn().mockReturnValue(undefined) };
    mail = {
      sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
      sendNewOrderToAdmin: jest.fn().mockResolvedValue(undefined),
    };
    settings = { getWhatsapp: jest.fn().mockResolvedValue('+58 412-1234567') };
    exchangeRate = { getRate: jest.fn() };

    service = new PaymentsService(
      prisma as any,
      stripe as any,
      config as any,
      mail as any,
      settings as any,
      exchangeRate as any,
    );
  });

  it('lanza BadRequestException si un producto con variantes no trae variantId', async () => {
    prisma.product.findMany.mockResolvedValue([variantProduct]);

    const dto = {
      items: [{ productId: 'prod-variant', quantity: 1 }],
    };

    await expect(service.createWhatsappOrder(dto as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.createWhatsappOrder(dto as any)).rejects.toThrow(
      'Selecciona una variante',
    );

    // No se debe crear ninguna orden si la validación falla.
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('lanza BadRequestException si el método es en bolívares y getRate falla (no usa 1:1)', async () => {
    prisma.product.findMany.mockResolvedValue([simpleProduct]);
    // La fuente de la tasa rechaza -> el servicio aborta en vez de cotizar 1:1.
    exchangeRate.getRate.mockRejectedValue(new Error('fuente caída'));

    const dto = {
      items: [{ productId: 'prod-simple', quantity: 2 }],
      paymentMethod: 'transferencia_bs',
    };

    await expect(service.createWhatsappOrder(dto as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.createWhatsappOrder(dto as any)).rejects.toThrow(
      /tasa de cambio/i,
    );

    // Se llegó a consultar la tasa, pero NO se creó la orden.
    expect(exchangeRate.getRate).toHaveBeenCalled();
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('lanza el mismo error si getRate resuelve con una tasa no positiva', async () => {
    prisma.product.findMany.mockResolvedValue([simpleProduct]);
    exchangeRate.getRate.mockResolvedValue({ rate: 40, bsRate: 0 });

    const dto = {
      items: [{ productId: 'prod-simple', quantity: 1 }],
      paymentMethod: 'pago_movil',
    };

    await expect(service.createWhatsappOrder(dto as any)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('con método en USD (zelle) NO llama getRate y crea la orden en moneda usd', async () => {
    prisma.product.findMany.mockResolvedValue([simpleProduct]);

    const dto = {
      items: [{ productId: 'prod-simple', quantity: 2 }],
      paymentMethod: 'zelle',
    };

    const result = await service.createWhatsappOrder(dto as any);

    // En USD la tasa no se consulta.
    expect(exchangeRate.getRate).not.toHaveBeenCalled();

    // La orden se crea con currency 'usd', sin tasa histórica y monto en USD crudo.
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    const createArg = prisma.order.create.mock.calls[0][0];
    expect(createArg.data.currency).toBe('usd');
    expect(createArg.data.exchangeRateAtCreation).toBeNull();
    expect(createArg.data.paymentMethod).toBe('zelle');
    // 2 unidades * $10 = $20 (sin conversión).
    expect(createArg.data.total).toBe(20);

    // Devuelve resumen con la URL de WhatsApp y el id de la orden.
    expect(result.orderId).toBe('ckorder123456789');
    expect(result.whatsappUrl).toContain('https://wa.me/');
    // El número se normaliza a solo dígitos.
    expect(result.whatsappUrl).toContain('584121234567');
  });

  it('con transferencia_usd tampoco consulta la tasa y guarda currency usd', async () => {
    prisma.product.findMany.mockResolvedValue([simpleProduct]);

    const dto = {
      items: [{ productId: 'prod-simple', quantity: 1 }],
      paymentMethod: 'transferencia_usd',
    };

    await service.createWhatsappOrder(dto as any);

    expect(exchangeRate.getRate).not.toHaveBeenCalled();
    const createArg = prisma.order.create.mock.calls[0][0];
    expect(createArg.data.currency).toBe('usd');
  });
});
