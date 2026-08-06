import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

// Test unitario plano: instancia AuthService con dependencias mockeadas.
// bcryptjs es REAL; JwtService se mockea como { signAsync }.
describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
  };
  let jwt: { signAsync: jest.Mock };

  // Usuario "de la BD" con password hasheado real (bcrypt).
  const dbUser = {
    id: 'user-1',
    email: 'admin@orthodonca.com',
    name: 'Admin',
    role: 'ADMIN',
    tokenVersion: 3,
    password: bcrypt.hashSync('correcta123', 10),
  };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(dbUser),
      },
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed-token') };

    service = new AuthService(jwt as any, prisma as any);
  });

  describe('login', () => {
    it('normaliza el email (trim + lowercase) al buscar el usuario', async () => {
      prisma.user.findUnique.mockResolvedValue(dbUser);

      await service.login('  Admin@Orthodonca.COM  ', 'correcta123');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'admin@orthodonca.com' },
      });
    });

    it('lanza UnauthorizedException si el usuario no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login('nadie@x.com', 'lo-que-sea'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('lanza UnauthorizedException si la contraseña no coincide', async () => {
      prisma.user.findUnique.mockResolvedValue(dbUser);

      await expect(
        service.login(dbUser.email, 'incorrecta'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('con credenciales válidas firma el token con el payload esperado y devuelve datos públicos', async () => {
      prisma.user.findUnique.mockResolvedValue(dbUser);

      const result = await service.login(dbUser.email, 'correcta123');

      // El payload del JWT incluye sub, email, name, role y tokenVersion.
      expect(jwt.signAsync).toHaveBeenCalledTimes(1);
      expect(jwt.signAsync).toHaveBeenCalledWith({
        sub: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        role: dbUser.role,
        tokenVersion: dbUser.tokenVersion,
      });

      expect(result.access_token).toBe('signed-token');
      // La respuesta pública NO expone el password ni el id.
      expect(result.user).toEqual({
        email: dbUser.email,
        name: dbUser.name,
        role: dbUser.role,
      });
      expect(result.user).not.toHaveProperty('password');
    });
  });

  describe('logout', () => {
    it('incrementa tokenVersion del usuario y devuelve { ok: true }', async () => {
      const result = await service.logout('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { tokenVersion: { increment: 1 } },
      });
      expect(result).toEqual({ ok: true });
    });
  });
});
