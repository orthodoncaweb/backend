import { ServiceUnavailableException } from '@nestjs/common';
import { StripeService } from './stripe.service';

// Test unitario plano: ConfigService mockeado como objeto con get: jest.fn().
// Stripe es real, pero su constructor NO hace red (solo guarda configuración),
// así que instanciarlo con una clave ficticia es seguro y determinista.
describe('StripeService', () => {
  function makeConfig(values: Record<string, string | undefined>) {
    return { get: jest.fn((key: string) => values[key]) };
  }

  describe('sin STRIPE_SECRET_KEY', () => {
    it('isConfigured es false', () => {
      const service = new StripeService(makeConfig({}) as any);
      expect(service.isConfigured).toBe(false);
    });

    it('getClient lanza ServiceUnavailableException', () => {
      const service = new StripeService(makeConfig({}) as any);
      expect(() => service.getClient()).toThrow(ServiceUnavailableException);
    });
  });

  describe('con STRIPE_SECRET_KEY', () => {
    it('isConfigured es true y getClient devuelve el cliente', () => {
      const service = new StripeService(
        makeConfig({ STRIPE_SECRET_KEY: 'sk_test_fake_key_123' }) as any,
      );
      expect(service.isConfigured).toBe(true);
      expect(service.getClient()).toBeDefined();
    });
  });

  describe('webhookSecret', () => {
    it('devuelve el valor configurado del webhook', () => {
      const service = new StripeService(
        makeConfig({ STRIPE_WEBHOOK_SECRET: 'whsec_123' }) as any,
      );
      expect(service.webhookSecret).toBe('whsec_123');
    });

    it('devuelve undefined cuando no está configurado', () => {
      const service = new StripeService(makeConfig({}) as any);
      expect(service.webhookSecret).toBeUndefined();
    });
  });
});
