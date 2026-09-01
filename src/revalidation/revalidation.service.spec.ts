import { RevalidationService } from './revalidation.service';

// Deja correr las promesas pendientes del envío "fire and forget".
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('RevalidationService', () => {
  const makeConfig = (env: Record<string, string | undefined>) => ({
    get: (key: string) => env[key],
  });

  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isConfigured', () => {
    it('es false si falta el secreto', () => {
      const service = new RevalidationService(
        makeConfig({ FRONTEND_URL: 'http://localhost:3000' }) as any,
      );
      expect(service.isConfigured).toBe(false);
    });

    it('es false si falta la URL del frontend', () => {
      const service = new RevalidationService(makeConfig({ REVALIDATE_SECRET: 's3cr3t' }) as any);
      expect(service.isConfigured).toBe(false);
    });

    it('usa el primer origen de CORS_ORIGINS si no hay FRONTEND_URL', () => {
      const service = new RevalidationService(
        makeConfig({
          CORS_ORIGINS: 'https://orthodonca.com,https://www.orthodonca.com',
          REVALIDATE_SECRET: 's3cr3t',
        }) as any,
      );
      expect(service.isConfigured).toBe(true);
    });
  });

  describe('revalidateTags', () => {
    const configured = () =>
      new RevalidationService(
        makeConfig({ FRONTEND_URL: 'http://localhost:3000/', REVALIDATE_SECRET: 's3cr3t' }) as any,
      );

    it('no llama al frontend si no está configurado', async () => {
      const service = new RevalidationService(makeConfig({}) as any);
      service.revalidateTags(['products']);
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('no llama al frontend si la lista de etiquetas queda vacía', async () => {
      configured().revalidateTags(['', '']);
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('hace POST a /revalidate con el secreto y las etiquetas', async () => {
      configured().revalidateTags(['products', 'product:abc']);
      await flush();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      // La barra final de FRONTEND_URL no debe duplicarse.
      expect(url).toBe('http://localhost:3000/revalidate');
      expect(init.method).toBe('POST');
      expect(init.headers['x-revalidate-secret']).toBe('s3cr3t');
      expect(JSON.parse(init.body)).toEqual({ tags: ['products', 'product:abc'] });
    });

    it('elimina etiquetas duplicadas', async () => {
      configured().revalidateTags(['products', 'products', 'product:abc']);
      await flush();

      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        tags: ['products', 'product:abc'],
      });
    });

    it('no lanza si el frontend responde con error', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('boom') });
      expect(() => configured().revalidateTags(['products'])).not.toThrow();
      await flush();
    });

    it('no lanza si el frontend es inalcanzable', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      expect(() => configured().revalidateTags(['products'])).not.toThrow();
      await flush();
    });
  });

  describe('revalidateProduct', () => {
    it('purga el listado y la ficha del producto', async () => {
      const service = new RevalidationService(
        makeConfig({ FRONTEND_URL: 'http://localhost:3000', REVALIDATE_SECRET: 's3cr3t' }) as any,
      );
      service.revalidateProduct('abc123');
      await flush();

      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        tags: ['products', 'product:abc123'],
      });
    });

    it('sin id purga solo los listados', async () => {
      const service = new RevalidationService(
        makeConfig({ FRONTEND_URL: 'http://localhost:3000', REVALIDATE_SECRET: 's3cr3t' }) as any,
      );
      service.revalidateProduct();
      await flush();

      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ tags: ['products'] });
    });
  });
});
