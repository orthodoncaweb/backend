import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Igual que JwtAuthGuard pero exige que el token sea de un usuario admin
// (tiene `role`). Los tokens de clientes no tienen `role`, así que se rechazan.
@Injectable()
export class AdminGuard extends AuthGuard('jwt') {
  handleRequest<TUser = { role?: string }>(err: unknown, user: TUser): TUser {
    const hasRole =
      user && typeof user === 'object' && 'role' in user && Boolean((user as { role?: string }).role);
    if (err || !user || !hasRole) {
      throw new UnauthorizedException('Acceso restringido al personal administrativo');
    }
    return user;
  }
}
