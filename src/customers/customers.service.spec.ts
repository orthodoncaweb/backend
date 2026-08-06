import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { CustomersService } from './customers.service';

// Tipos laxos para los mocks: solo nos importan los métodos que usa el servicio.
type AnyFn = jest.Mock;

interface PrismaMock {
  customer: {
    findUnique: AnyFn;
    create: AnyFn;
    update: AnyFn;
    findMany: AnyFn;
  };
}

interface JwtMock {
  signAsync: AnyFn;
  verifyAsync: AnyFn;
}

interface MailMock {
  sendVerifyEmail: AnyFn;
  sendWelcome: AnyFn;
}

interface ConfigMock {
  get: AnyFn;
}

describe('CustomersService', () => {
  let service: CustomersService;
  let prisma: PrismaMock;
  let jwt: JwtMock;
  let mail: MailMock;
  let config: ConfigMock;

  // Cliente base "de la BD" que devuelve Prisma (incluye campos privados).
  const dbCustomer = {
    id: 'cust-1',
    name: 'Ana',
    lastName: 'Pérez',
    specialty: 'Ortodoncia',
    email: 'ana@example.com',
    password: bcrypt.hashSync('secret123', 10),
    tokenVersion: 0,
    emailVerified: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    prisma = {
      customer: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };
    jwt = {
      signAsync: jest.fn().mockResolvedValue('tok'),
      verifyAsync: jest.fn(),
    };
    mail = {
      sendVerifyEmail: jest.fn().mockResolvedValue(undefined),
      sendWelcome: jest.fn().mockResolvedValue(undefined),
    };
    config = {
      get: jest.fn().mockReturnValue('http://localhost:3000'),
    };

    service = new CustomersService(
      prisma as any,
      jwt as any,
      mail as any,
      config as any,
    );
  });

  describe('register', () => {
    const dto = {
      name: 'Ana',
      lastName: 'Pérez',
      specialty: 'Ortodoncia',
      email: 'ana@example.com',
      password: 'secret123',
    } as any;

    it('lanza ConflictException si el correo ya existe', async () => {
      prisma.customer.findUnique.mockResolvedValue(dbCustomer);

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('crea el cliente con password hasheado y devuelve token + datos públicos', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);
      prisma.customer.create.mockResolvedValue(dbCustomer);

      const result = await service.register(dto);

      // Se intentó verificar duplicado por email.
      expect(prisma.customer.findUnique).toHaveBeenCalledWith({
        where: { email: dto.email },
      });

      // El password guardado está hasheado (no es el texto plano) y es válido con bcrypt.
      expect(prisma.customer.create).toHaveBeenCalledTimes(1);
      const createArg = prisma.customer.create.mock.calls[0][0];
      const storedPassword = createArg.data.password;
      expect(storedPassword).not.toBe(dto.password);
      expect(bcrypt.compareSync(dto.password, storedPassword)).toBe(true);
      expect(createArg.data.email).toBe(dto.email);

      // Token emitido y respuesta pública (sin password ni tokenVersion).
      expect(result.access_token).toBe('tok');
      expect(result.customer).toEqual({
        id: dbCustomer.id,
        name: dbCustomer.name,
        lastName: dbCustomer.lastName,
        specialty: dbCustomer.specialty,
        email: dbCustomer.email,
      });
      expect(result.customer).not.toHaveProperty('password');
      expect(result.customer).not.toHaveProperty('tokenVersion');

      // Se intentó enviar el correo de verificación.
      expect(mail.sendVerifyEmail).toHaveBeenCalledTimes(1);
    });

    it('no rompe el registro si el envío de correo falla', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);
      prisma.customer.create.mockResolvedValue(dbCustomer);
      mail.sendVerifyEmail.mockRejectedValue(new Error('SMTP caído'));

      const result = await service.register(dto);

      // A pesar del fallo de correo, el registro se completa con token.
      expect(result.access_token).toBe('tok');
      expect(result.customer.email).toBe(dbCustomer.email);
    });
  });

  describe('login', () => {
    const dto = { email: 'ana@example.com', password: 'secret123' } as any;

    it('lanza UnauthorizedException si el cliente no existe', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('lanza UnauthorizedException si la contraseña no coincide', async () => {
      prisma.customer.findUnique.mockResolvedValue(dbCustomer);

      await expect(
        service.login({ email: dbCustomer.email, password: 'wrong-pass' } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('devuelve token y datos públicos con credenciales correctas', async () => {
      prisma.customer.findUnique.mockResolvedValue(dbCustomer);

      const result = await service.login(dto);

      expect(result.access_token).toBe('tok');
      expect(result.customer).toEqual({
        id: dbCustomer.id,
        name: dbCustomer.name,
        lastName: dbCustomer.lastName,
        specialty: dbCustomer.specialty,
        email: dbCustomer.email,
      });
      expect(jwt.signAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('verifyEmail', () => {
    it('lanza BadRequestException si el token es inválido (verifyAsync falla)', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(service.verifyEmail('bad-token')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si el purpose no es verify-email', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'cust-1', purpose: 'reset-password' });

      await expect(service.verifyEmail('tok')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si falta el sub', async () => {
      jwt.verifyAsync.mockResolvedValue({ purpose: 'verify-email' });

      await expect(service.verifyEmail('tok')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('marca emailVerified y devuelve { ok: true } con token válido', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'cust-1', purpose: 'verify-email' });
      prisma.customer.findUnique.mockResolvedValue({
        ...dbCustomer,
        emailVerified: false,
      });
      prisma.customer.update.mockResolvedValue({ ...dbCustomer, emailVerified: true });

      const result = await service.verifyEmail('tok');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { emailVerified: true },
      });
      expect(result.ok).toBe(true);
      expect(result.alreadyVerified).toBe(false);
    });

    it('no vuelve a actualizar si el correo ya estaba verificado', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'cust-1', purpose: 'verify-email' });
      prisma.customer.findUnique.mockResolvedValue({
        ...dbCustomer,
        emailVerified: true,
      });

      const result = await service.verifyEmail('tok');

      expect(prisma.customer.update).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true, alreadyVerified: true });
    });
  });

  describe('logout', () => {
    it('incrementa tokenVersion y devuelve { ok: true }', async () => {
      prisma.customer.update.mockResolvedValue(dbCustomer);

      const result = await service.logout('cust-1');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { tokenVersion: { increment: 1 } },
      });
      expect(result).toEqual({ ok: true });
    });
  });
});
