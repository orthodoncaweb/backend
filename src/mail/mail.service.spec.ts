import { MailService } from './mail.service';
import * as nodemailer from 'nodemailer';

// Mockeamos nodemailer para no abrir conexiones SMTP reales.
jest.mock('nodemailer');

describe('MailService', () => {
  const sendMail = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    sendMail.mockClear();
    (nodemailer.createTransport as jest.Mock).mockClear();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
  });

  function makeConfig(values: Record<string, string | undefined>) {
    return { get: jest.fn((key: string) => values[key]) };
  }

  // Config SMTP mínima válida (host + user) para que isConfigured sea true.
  const smtpValues = {
    SMTP_HOST: 'smtp.test',
    SMTP_USER: 'user@test',
    SMTP_PASS: 'pass',
    SMTP_PORT: '587',
    SMTP_FROM: 'Orthodonca <no-reply@test>',
  };

  describe('SMTP no configurado (no-op)', () => {
    it('no crea transporter ni intenta enviar correos', async () => {
      const service = new MailService(makeConfig({}) as any);

      // Sin host/user -> createTransport no se llama.
      expect(nodemailer.createTransport).not.toHaveBeenCalled();

      // Los métodos públicos no lanzan y no envían nada.
      await expect(service.sendWelcome('a@b.com', 'Ana')).resolves.toBeUndefined();
      expect(sendMail).not.toHaveBeenCalled();
    });
  });

  describe('SMTP configurado', () => {
    it('crea el transporter con host/port/secure/auth', () => {
      new MailService(makeConfig(smtpValues) as any);

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.test',
          port: 587,
          secure: false,
          auth: { user: 'user@test', pass: 'pass' },
        }),
      );
    });

    it('sendWelcome envía con asunto y destinatario correctos', async () => {
      const service = new MailService(makeConfig(smtpValues) as any);

      await service.sendWelcome('cliente@test', 'Ana');

      expect(sendMail).toHaveBeenCalledTimes(1);
      const arg = sendMail.mock.calls[0][0];
      expect(arg.to).toBe('cliente@test');
      expect(arg.subject).toBe('Bienvenido a Orthodonca');
      expect(arg.from).toBe('Orthodonca <no-reply@test>');
      expect(arg.html).toContain('Ana');
    });

    it('sendOrderConfirmation formatea montos USD ($) por defecto', async () => {
      const service = new MailService(makeConfig(smtpValues) as any);

      await service.sendOrderConfirmation('cliente@test', {
        id: 'ORD-1',
        total: 199.5,
        items: [{ name: 'Bracket', quantity: 2, unitPrice: 99.75 }],
      });

      const arg = sendMail.mock.calls[0][0];
      expect(arg.subject).toContain('ORD-1');
      // Montos en USD con formato $xx.xx.
      expect(arg.html).toContain('$199.50');
      expect(arg.html).toContain('$99.75');
    });

    it('sendOrderConfirmation formatea montos VES (Bs.) cuando currency=ves', async () => {
      const service = new MailService(makeConfig(smtpValues) as any);

      await service.sendOrderConfirmation('cliente@test', {
        id: 'ORD-2',
        total: 1000,
        currency: 'ves',
        items: [{ name: 'Bracket', quantity: 1, unitPrice: 1000 }],
      });

      const arg = sendMail.mock.calls[0][0];
      expect(arg.html).toContain('Bs.');
    });

    it('sendOrderShipped incluye el número de seguimiento cuando se provee', async () => {
      const service = new MailService(makeConfig(smtpValues) as any);

      await service.sendOrderShipped(
        'cliente@test',
        { id: 'ORD-3', total: 10, items: [] },
        'TRACK-123',
      );

      const arg = sendMail.mock.calls[0][0];
      expect(arg.subject).toContain('ORD-3');
      expect(arg.html).toContain('TRACK-123');
    });

    it('no lanza si sendMail falla (el envío central captura el error)', async () => {
      sendMail.mockRejectedValueOnce(new Error('SMTP caído'));
      const service = new MailService(makeConfig(smtpValues) as any);

      await expect(
        service.sendPasswordReset('cliente@test', 'https://app/reset?token=x'),
      ).resolves.toBeUndefined();
    });
  });

  // La API HTTP tiene prioridad sobre SMTP: funciona en hostings que bloquean
  // los puertos SMTP (Railway Hobby).
  describe('API HTTP de Brevo (BREVO_API_KEY)', () => {
    const apiValues = { ...smtpValues, BREVO_API_KEY: 'xkeysib-test' };
    let fetchMock: jest.Mock;

    beforeEach(() => {
      fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 201 });
      global.fetch = fetchMock as unknown as typeof fetch;
    });

    it('no usa SMTP: no crea transporter aunque haya credenciales SMTP', () => {
      new MailService(makeConfig(apiValues) as any);
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it('envía por HTTPS a la API con la api-key y el cuerpo esperado', async () => {
      const service = new MailService(makeConfig(apiValues) as any);

      await service.sendWelcome('cliente@test', 'Ana');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.brevo.com/v3/smtp/email');
      expect(init.method).toBe('POST');
      expect(init.headers['api-key']).toBe('xkeysib-test');

      const body = JSON.parse(init.body);
      // "Orthodonca <no-reply@test>" se separa en nombre y correo.
      expect(body.sender).toEqual({ name: 'Orthodonca', email: 'no-reply@test' });
      expect(body.to).toEqual([{ email: 'cliente@test' }]);
      expect(body.subject).toBe('Bienvenido a Orthodonca');
      expect(body.htmlContent).toContain('Ana');
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('no lanza si la API responde error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('unauthorized'),
      });
      const service = new MailService(makeConfig(apiValues) as any);

      await expect(
        service.sendPasswordReset('cliente@test', 'https://app/reset?token=x'),
      ).resolves.toBeUndefined();
    });
  });
});
