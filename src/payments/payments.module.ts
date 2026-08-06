import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { CheckoutController } from './checkout.controller';
import { OrdersController } from './orders.controller';
import { CustomerOrdersController } from './customer-orders.controller';
import { MailModule } from '../mail/mail.module';
import { SettingsModule } from '../settings/settings.module';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';

@Module({
  imports: [
    MailModule,
    SettingsModule,
    ExchangeRateModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-secret-change-me',
      }),
    }),
  ],
  providers: [StripeService, PaymentsService],
  controllers: [CheckoutController, OrdersController, CustomerOrdersController],
})
export class PaymentsModule {}
