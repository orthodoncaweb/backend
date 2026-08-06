import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe = require('stripe');

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly client?: Stripe.Stripe;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (key) {
      this.client = new Stripe(key);
      this.logger.log('Stripe configurado.');
    } else {
      this.logger.warn('Stripe NO configurado (falta STRIPE_SECRET_KEY).');
    }
  }

  get isConfigured(): boolean {
    return Boolean(this.client);
  }

  getClient(): Stripe.Stripe {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'La pasarela de pago no está configurada todavía.',
      );
    }
    return this.client;
  }

  get webhookSecret(): string | undefined {
    return this.config.get<string>('STRIPE_WEBHOOK_SECRET');
  }
}
