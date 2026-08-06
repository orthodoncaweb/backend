import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import helmet from 'helmet';
import { AppModule } from './app.module';

// Falla rápido y claro si faltan variables críticas o el JWT_SECRET es débil.
function assertEnv() {
  const required = ['DATABASE_URL', 'JWT_SECRET'];
  const missing = required.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    console.error(
      `❌ Faltan variables de entorno críticas: ${missing.join(', ')}. La aplicación no puede arrancar.`,
    );
    process.exit(1);
  }
  if ((process.env.JWT_SECRET ?? '').length < 32) {
    console.error(
      '❌ JWT_SECRET es demasiado corto (mín. 32 caracteres). Genera uno aleatorio fuerte por ambiente.',
    );
    process.exit(1);
  }
}

async function bootstrap() {
  assertEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // necesario para verificar la firma del webhook de Stripe
  });
  // Detrás del proxy de Next (same-origin) y de Cloudflare: confía en
  // X-Forwarded-* para que req.ip refleje la IP real del cliente (rate limiting).
  app.set('trust proxy', 1);
  const config = app.get(ConfigService);

  // Cabeceras de seguridad HTTP (helmet).
  // Permitimos recursos cross-origin para que el frontend (otro puerto) pueda
  // cargar las imágenes servidas desde /uploads.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Sirve las imágenes guardadas localmente (fallback) en /uploads
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });

  // Prefijo global para todas las rutas de la API (ej: /api/products)
  app.setGlobalPrefix('api');

  // Validación automática de los DTOs en todas las peticiones entrantes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // elimina propiedades no declaradas en el DTO
      forbidNonWhitelisted: true, // lanza error si llegan propiedades extra
      transform: true, // transforma payloads a instancias de los DTO
    }),
  );

  // CORS: lista blanca de orígenes (separados por coma en CORS_ORIGINS o
  // FRONTEND_URL). Con el proxy same-origin el navegador ya no hace CORS; esto
  // cubre accesos directos al backend (panel/Swagger u otros clientes).
  const corsOrigins = (
    process.env.CORS_ORIGINS ??
    process.env.FRONTEND_URL ??
    'http://localhost:3000'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins, credentials: true });

  const port = config.get<number>('PORT') ?? 4000;
  await app.listen(port);
  console.log(`🚀 Backend escuchando en http://localhost:${port}/api`);
}
bootstrap();
