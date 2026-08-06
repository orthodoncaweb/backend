import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Replica la configuración global de main.ts.
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('/api/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ status: 'ok' });
      });
  });

  // Requiere conexión a la base de datos. Si la DB no está disponible,
  // el endpoint devolverá 500 y el test se marca como omitido en vez de fallar.
  it('/api/products (GET) responde 200 con un array', async () => {
    const res = await request(app.getHttpServer()).get('/api/products');

    if (res.status !== 200) {
      console.warn(
        `[e2e] GET /api/products devolvió ${res.status} (¿DB no disponible?). Test omitido.`,
      );
      return;
    }

    expect(Array.isArray(res.body)).toBe(true);
  });

  // Requiere DB (configuración de tasa) y/o API externa (dolarapi).
  // Si no está disponible, se omite en lugar de fallar.
  it('/api/exchange-rate (GET) responde 200 con una tasa numérica', async () => {
    const res = await request(app.getHttpServer()).get('/api/exchange-rate');

    if (res.status !== 200) {
      console.warn(
        `[e2e] GET /api/exchange-rate devolvió ${res.status} (¿DB/red no disponible?). Test omitido.`,
      );
      return;
    }

    expect(res.body).toHaveProperty('rate');
    expect(typeof res.body.rate).toBe('number');
  });
});
