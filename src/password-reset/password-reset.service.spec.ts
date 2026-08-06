import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PasswordResetService } from './password-reset.service';

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let prisma: {
    customer: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };
  let config: { get: jest.Mock };
  let mail: { sendPasswordReset: jest.Mock };

  beforeEach(() => {
    prisma = {
      customer: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    config = { get: jest.fn() };
    mail = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };

    service = new PasswordResetService(
      prisma as any,
      config as any,
      mail as any,
    );
  });

  describe('forgotPassword', () => {
    it('devuelve { ok: true } sin enviar correo cuando el cliente NO existe (no revela existencia)', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword('nadie@example.com');

      expect(result).toEqual({ ok: true });
      expect(prisma.customer.update).not.toHaveBeenCalled();
      expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('normaliza el email (trim + lowercase) al buscar el cliente', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await service.forgotPassword('  Foo@Example.COM  ');

      expect(prisma.customer.findUnique).toHaveBeenCalledWith({
        where: { email: 'foo@example.com' },
      });
    });

    it('cuando el cliente existe: guarda el HASH sha256 del token (NO el token en claro) y envía el correo', async () => {
      const customer = { id: 'cust-1', email: 'user@example.com' };
      prisma.customer.findUnique.mockResolvedValue(customer);
      config.get.mockReturnValue('https://app.test');

      await service.forgotPassword('user@example.com');

      // update fue llamado una vez con el resetToken hasheado
      expect(prisma.customer.update).toHaveBeenCalledTimes(1);
      const updateArg = prisma.customer.update.mock.calls[0][0];
      expect(updateArg.where).toEqual({ id: 'cust-1' });

      const storedToken: string = updateArg.data.resetToken;
      // Es un hash sha256: 64 caracteres hexadecimales
      expect(storedToken).toMatch(/^[0-9a-f]{64}$/);
      // Hay expiración en el futuro
      expect(updateArg.data.resetTokenExpiresAt).toBeInstanceOf(Date);
      expect(
        (updateArg.data.resetTokenExpiresAt as Date).getTime(),
      ).toBeGreaterThan(Date.now());

      // El correo se envió con un enlace que contiene el token en CLARO
      expect(mail.sendPasswordReset).toHaveBeenCalledTimes(1);
      const [toEmail, link] = mail.sendPasswordReset.mock.calls[0];
      expect(toEmail).toBe('user@example.com');

      const url = new URL(link);
      const plainToken = url.searchParams.get('token')!;
      expect(plainToken).toBeTruthy();

      // El token del enlace NO es igual al almacenado (uno es claro, otro hash)
      expect(plainToken).not.toBe(storedToken);
      // Y el almacenado es exactamente el sha256 del token enviado
      expect(storedToken).toBe(sha256(plainToken));
    });

    it('usa FRONTEND_URL del config para construir el enlace', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-2',
        email: 'a@b.com',
      });
      config.get.mockReturnValue('https://mi-front.example');

      await service.forgotPassword('a@b.com');

      const link = mail.sendPasswordReset.mock.calls[0][1];
      expect(link).toContain('https://mi-front.example/restablecer?token=');
    });

    it('usa el fallback localhost:3000 cuando FRONTEND_URL no está configurado', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-3',
        email: 'a@b.com',
      });
      config.get.mockReturnValue(undefined);

      await service.forgotPassword('a@b.com');

      const link = mail.sendPasswordReset.mock.calls[0][1];
      expect(link).toContain('http://localhost:3000/restablecer?token=');
    });

    it('no rompe el flujo y devuelve { ok: true } aunque el envío de correo falle', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-4',
        email: 'a@b.com',
      });
      config.get.mockReturnValue('https://app.test');
      mail.sendPasswordReset.mockRejectedValue(new Error('SMTP caído'));

      const result = await service.forgotPassword('a@b.com');

      expect(result).toEqual({ ok: true });
      expect(prisma.customer.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetPassword', () => {
    it('lanza BadRequestException cuando el token es inválido/expirado (findFirst => null)', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword('token-malo', 'NuevaPass123'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('busca por el HASH del token (no el token en claro) y filtra por expiración futura', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      const plainToken = 'abc123';
      await expect(
        service.resetPassword(plainToken, 'NuevaPass123'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.customer.findFirst).toHaveBeenCalledTimes(1);
      const whereArg = prisma.customer.findFirst.mock.calls[0][0].where;
      // Se busca por el hash, nunca por el token en claro
      expect(whereArg.resetToken).toBe(sha256(plainToken));
      expect(whereArg.resetToken).not.toBe(plainToken);
      expect(whereArg.resetTokenExpiresAt).toHaveProperty('gt');
      expect(whereArg.resetTokenExpiresAt.gt).toBeInstanceOf(Date);
    });

    it('con token válido: actualiza password (hash bcrypt), limpia resetToken y aumenta tokenVersion', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust-9',
        email: 'user@example.com',
      });

      const result = await service.resetPassword('token-bueno', 'NuevaPass123');

      expect(result).toEqual({ ok: true });
      expect(prisma.customer.update).toHaveBeenCalledTimes(1);

      const updateArg = prisma.customer.update.mock.calls[0][0];
      expect(updateArg.where).toEqual({ id: 'cust-9' });

      // Single-use: token limpiado a null
      expect(updateArg.data.resetToken).toBeNull();
      expect(updateArg.data.resetTokenExpiresAt).toBeNull();
      // Revoca sesiones: incrementa tokenVersion
      expect(updateArg.data.tokenVersion).toEqual({ increment: 1 });

      // Password almacenado es un hash bcrypt válido de la nueva contraseña
      expect(updateArg.data.password).not.toBe('NuevaPass123');
      expect(bcrypt.compareSync('NuevaPass123', updateArg.data.password)).toBe(
        true,
      );
    });
  });
});
