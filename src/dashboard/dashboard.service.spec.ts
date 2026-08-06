import { DashboardService } from './dashboard.service';

// Test unitario plano: PrismaService y ExchangeRateService mockeados.
describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: {
    order: { findMany: jest.Mock; count: jest.Mock };
    product: { count: jest.Mock };
    customer: { count: jest.Mock };
  };
  let exchangeRate: { getRate: jest.Mock };

  beforeEach(() => {
    prisma = {
      order: { findMany: jest.fn(), count: jest.fn() },
      product: { count: jest.fn() },
      customer: { count: jest.fn() },
    };
    exchangeRate = { getRate: jest.fn() };
    service = new DashboardService(prisma as any, exchangeRate as any);
  });

  // Helper: configura las 2 llamadas a order.findMany en orden:
  //   1) órdenes pagadas del mes  2) órdenes recientes.
  function setupOrders(paid: any[], recent: any[]) {
    prisma.order.findMany
      .mockResolvedValueOnce(paid) // paidOrders
      .mockResolvedValueOnce(recent); // recent
    prisma.order.count.mockResolvedValue(42);
    prisma.product.count.mockResolvedValue(10);
    prisma.customer.count.mockResolvedValue(7);
  }

  it('suma ventas USD directas y devuelve los contadores', async () => {
    setupOrders(
      [
        { total: 100, currency: 'usd', exchangeRateAtCreation: null },
        { total: 50, currency: 'usd', exchangeRateAtCreation: null },
      ],
      [],
    );
    exchangeRate.getRate.mockResolvedValue({ rate: 36 });

    const result = await service.getStats();

    expect(result.salesThisMonth).toBe(150);
    expect(result.ordersCount).toBe(42);
    expect(result.productsCount).toBe(10);
    expect(result.customersCount).toBe(7);
    expect(result.recentOrders).toEqual([]);
  });

  it('convierte órdenes en VES usando la tasa HISTÓRICA guardada en la orden', async () => {
    setupOrders(
      [
        // 3600 Bs / 36 = 100 USD (tasa histórica de la orden).
        { total: 3600, currency: 'ves', exchangeRateAtCreation: 36 },
      ],
      [],
    );
    // La tasa actual es distinta; NO debe usarse porque la orden trae histórica.
    exchangeRate.getRate.mockResolvedValue({ rate: 40 });

    const result = await service.getStats();

    expect(result.salesThisMonth).toBe(100);
  });

  it('usa la tasa ACTUAL para órdenes VES sin tasa histórica', async () => {
    setupOrders(
      [{ total: 4000, currency: 'ves', exchangeRateAtCreation: null }],
      [],
    );
    exchangeRate.getRate.mockResolvedValue({ rate: 40 }); // 4000/40 = 100

    const result = await service.getStats();

    expect(result.salesThisMonth).toBe(100);
  });

  it('si getRate falla usa tasa=1 (las VES sin histórica no se dividen)', async () => {
    setupOrders(
      [{ total: 4000, currency: 'ves', exchangeRateAtCreation: null }],
      [],
    );
    exchangeRate.getRate.mockRejectedValue(new Error('fuente caída'));

    const result = await service.getStats();

    // rate=1 -> 4000/1 = 4000.
    expect(result.salesThisMonth).toBe(4000);
  });

  it('mapea las órdenes recientes: nombre de cliente, invitado o email', async () => {
    setupOrders([], [
      {
        id: 'o1',
        customer: { name: 'Ana', lastName: 'Pérez' },
        customerEmail: 'ana@x.com',
        total: 10,
        currency: 'usd',
        status: 'PAID',
        fulfillmentStatus: 'ENVIADO',
        createdAt: new Date('2026-06-01'),
      },
      {
        id: 'o2',
        customer: null,
        customerEmail: 'guest@x.com',
        total: 20,
        currency: 'usd',
        status: 'PENDING',
        fulfillmentStatus: 'PENDIENTE',
        createdAt: new Date('2026-06-02'),
      },
      {
        id: 'o3',
        customer: null,
        customerEmail: null,
        total: 30,
        currency: 'usd',
        status: 'PENDING',
        fulfillmentStatus: 'PENDIENTE',
        createdAt: new Date('2026-06-03'),
      },
    ]);
    exchangeRate.getRate.mockResolvedValue({ rate: 36 });

    const result = await service.getStats();

    expect(result.recentOrders[0].customerName).toBe('Ana Pérez');
    expect(result.recentOrders[1].customerName).toBe('guest@x.com');
    expect(result.recentOrders[2].customerName).toBe('Invitado');
    expect(result.recentOrders[0].total).toBe(10);
  });

  it('redondea salesThisMonth a 2 decimales', async () => {
    setupOrders(
      // 3000 Bs / 7 = 428.5714... -> 428.57.
      [{ total: 3000, currency: 'ves', exchangeRateAtCreation: 7 }],
      [],
    );
    exchangeRate.getRate.mockResolvedValue({ rate: 7 });

    const result = await service.getStats();

    expect(result.salesThisMonth).toBe(428.57);
  });
});
