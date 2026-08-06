import { ReportsService } from './reports.service';

// PrismaService simulado para reportes: devuelve órdenes/clientes fijos.
function makePrismaMock(opts: { orders?: any[]; customers?: any[] } = {}) {
  return {
    order: {
      findMany: jest.fn(() => Promise.resolve(opts.orders ?? [])),
    },
    customer: {
      findMany: jest.fn(() => Promise.resolve(opts.customers ?? [])),
    },
  };
}

// ExchangeRateService simulado (tasa de fallback = 1; los USD no se convierten).
function makeExchangeRateMock() {
  return { getRate: jest.fn().mockResolvedValue({ rate: 1 }) };
}

describe('ReportsService (escape CSV)', () => {
  describe('salesCsv', () => {
    it('envuelve cada campo en comillas y escapa comas/comillas internas', async () => {
      const orders = [
        {
          id: 'ord-1',
          createdAt: new Date('2026-01-15T10:00:00.000Z'),
          status: 'PAID',
          fulfillmentStatus: 'ENVIADO',
          paymentMethod: 'Stripe, USD',
          total: 199.5,
          customer: {
            name: 'José "Pepe"',
            lastName: 'Pérez, Jr.',
            email: 'pepe@example.com',
          },
        },
      ];
      const service = new ReportsService(
        makePrismaMock({ orders }) as any,
        makeExchangeRateMock() as any,
      );

      const csv = await service.salesCsv();
      const lines = csv.split('\r\n');

      // Cabecera: cada columna entre comillas.
      expect(lines[0]).toBe(
        '"id","fecha","cliente","email","estado_pago","estado_atencion","metodo","moneda","total","total_usd"',
      );

      // El nombre con comilla interna se duplica: " -> ""
      expect(lines[1]).toContain('"José ""Pepe"" Pérez, Jr."');
      // El método con coma queda envuelto y NO rompe columnas.
      expect(lines[1]).toContain('"Stripe, USD"');
      // El total se serializa como número (sin comillas raras alrededor del valor).
      expect(lines[1]).toContain('"199.5"');
      // Termina con CRLF final.
      expect(csv.endsWith('\r\n')).toBe(true);
    });

    it('usa shippingName/customerEmail cuando no hay customer asociado', async () => {
      const orders = [
        {
          id: 'ord-2',
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
          status: 'PENDING',
          fulfillmentStatus: 'PENDIENTE',
          paymentMethod: null,
          total: 50,
          customer: null,
          shippingName: 'Invitado',
          customerEmail: 'guest@example.com',
        },
      ];
      const service = new ReportsService(
        makePrismaMock({ orders }) as any,
        makeExchangeRateMock() as any,
      );

      const csv = await service.salesCsv();
      const dataLine = csv.split('\r\n')[1];

      expect(dataLine).toContain('"Invitado"');
      expect(dataLine).toContain('"guest@example.com"');
      // metodo nulo -> campo vacío entre comillas.
      expect(dataLine).toContain('""');
    });
  });

  describe('customersCsv', () => {
    it('escapa campos con comas y suma solo órdenes PAID', async () => {
      const customers = [
        {
          id: 'cus-1',
          name: 'Ana',
          lastName: 'García, López',
          email: 'ana@example.com',
          specialty: 'Ortodoncia, general',
          phone: '+58 412',
          city: 'Caracas',
          createdAt: new Date('2025-12-01T00:00:00.000Z'),
          orders: [
            { status: 'PAID', total: 100 },
            { status: 'PAID', total: 25.5 },
            { status: 'PENDING', total: 999 }, // no debe sumar
          ],
        },
      ];
      const service = new ReportsService(
        makePrismaMock({ customers }) as any,
        makeExchangeRateMock() as any,
      );

      const csv = await service.customersCsv();
      const lines = csv.split('\r\n');

      expect(lines[0]).toBe(
        '"id","nombre","apellido","email","especialidad","telefono","ciudad","registrado","pedidos","total_comprado_usd"',
      );
      // Apellido y especialidad con comas quedan envueltos.
      expect(lines[1]).toContain('"García, López"');
      expect(lines[1]).toContain('"Ortodoncia, general"');
      // Cantidad de pedidos = 3, total comprado solo PAID = 125.5.
      expect(lines[1]).toContain('"3"');
      expect(lines[1]).toContain('"125.5"');
    });
  });
});
