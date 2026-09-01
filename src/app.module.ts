import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CustomersModule } from './customers/customers.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { PricesModule } from './prices/prices.module';
import { PaymentsModule } from './payments/payments.module';
import { ExchangeRateModule } from './exchange-rate/exchange-rate.module';
import { UploadModule } from './upload/upload.module';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { BlogModule } from './blog/blog.module';
import { FavoritesModule } from './favorites/favorites.module';
import { ReportsModule } from './reports/reports.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PasswordResetModule } from './password-reset/password-reset.module';
import { SettingsModule } from './settings/settings.module';
import { RevalidationModule } from './revalidation/revalidation.module';

@Module({
  imports: [
    // Carga las variables de entorno desde .env y las hace disponibles
    // globalmente vía ConfigService (sin necesidad de re-importar el módulo).
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    // Limita la tasa de peticiones: 120 por minuto por IP.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    PrismaModule,
    RevalidationModule,
    AuthModule,
    UsersModule,
    CustomersModule,
    CategoriesModule,
    ProductsModule,
    PricesModule,
    PaymentsModule,
    ExchangeRateModule,
    UploadModule,
    MailModule,
    BlogModule,
    FavoritesModule,
    ReportsModule,
    DashboardModule,
    PasswordResetModule,
    SettingsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Aplica el rate limiting globalmente.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
