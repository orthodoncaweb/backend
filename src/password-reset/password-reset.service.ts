import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  // Guarda solo el hash del token; el token en claro va únicamente en el correo.
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async forgotPassword(email: string) {
    const normalizedEmail = email.trim().toLowerCase();

    const customer = await this.prisma.customer.findUnique({
      where: { email: normalizedEmail },
    });

    if (customer) {
      // Token aleatorio + expiración a 1h. En la BD se guarda solo el HASH.
      const token = randomBytes(32).toString('hex');
      const resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { resetToken: this.hashToken(token), resetTokenExpiresAt },
      });

      const frontendUrl =
        this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
      const link = `${frontendUrl}/restablecer?token=${token}`;

      // Envía el correo con el enlace de reseteo (no rompe el flujo si falla).
      try {
        await this.mail.sendPasswordReset(customer.email, link);
      } catch (err) {
        this.logger.error(
          `No se pudo enviar el correo de reseteo a ${email}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Nunca revela si el email existe
    return { ok: true };
  }

  async resetPassword(token: string, newPassword: string) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        resetToken: this.hashToken(token),
        resetTokenExpiresAt: { gt: new Date() },
      },
    });

    if (!customer) {
      throw new BadRequestException('Token inválido o expirado');
    }

    const hashed = bcrypt.hashSync(newPassword, 10);

    // Single-use (limpia el token) + revoca todas las sesiones (tokenVersion).
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        password: hashed,
        resetToken: null,
        resetTokenExpiresAt: null,
        tokenVersion: { increment: 1 },
      },
    });

    return { ok: true };
  }
}
