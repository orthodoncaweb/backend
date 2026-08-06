import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    const passwordMatches =
      user && bcrypt.compareSync(password, user.password);

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      access_token: accessToken,
      user: { email: user.email, name: user.name, role: user.role },
    };
  }

  // Cambio de la contraseña propia. Rota tokenVersion (cierra las demás
  // sesiones) y devuelve un token nuevo para no expulsar la sesión actual.
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (!bcrypt.compareSync(currentPassword, user.password)) {
      throw new UnauthorizedException('La contraseña actual es incorrecta');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: bcrypt.hashSync(newPassword, 10),
        tokenVersion: { increment: 1 },
      },
    });

    const accessToken = await this.jwtService.signAsync({
      sub: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      tokenVersion: updated.tokenVersion,
    });

    return { changed: true, access_token: accessToken };
  }

  // Cierre de sesión real: incrementa tokenVersion → revoca todos los JWT del admin.
  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    return { ok: true };
  }
}
