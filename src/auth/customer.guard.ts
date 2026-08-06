import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Acepta solo tokens de clientes (type === 'customer').
@Injectable()
export class CustomerGuard extends AuthGuard('jwt') {
  handleRequest<TUser = { type?: string }>(err: unknown, user: TUser): TUser {
    const isCustomer =
      user &&
      typeof user === 'object' &&
      (user as { type?: string }).type === 'customer';
    if (err || !user || !isCustomer) {
      throw new UnauthorizedException('Inicia sesión como cliente');
    }
    return user;
  }
}
