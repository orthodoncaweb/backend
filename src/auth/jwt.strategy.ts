import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role?: string;
  type?: string;
  tokenVersion?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // Verifica firma + expiración (passport) y, además, que el tokenVersion del
  // JWT coincida con el de la BD. Al cerrar sesión o cambiar contraseña se
  // incrementa el tokenVersion → los JWT emitidos antes quedan revocados.
  async validate(payload: JwtPayload) {
    const expected = payload.tokenVersion ?? 0;
    if (payload.type === 'customer') {
      const customer = await this.prisma.customer.findUnique({
        where: { id: payload.sub },
        select: { tokenVersion: true },
      });
      if (!customer || customer.tokenVersion !== expected) {
        throw new UnauthorizedException('Sesión expirada o cerrada');
      }
    } else {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { tokenVersion: true },
      });
      if (!user || user.tokenVersion !== expected) {
        throw new UnauthorizedException('Sesión expirada o cerrada');
      }
    }
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      type: payload.type,
    };
  }
}
