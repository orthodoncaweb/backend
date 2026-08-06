import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { LoginCustomerDto } from './dto/login-customer.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { MailService } from '../mail/mail.service';
import type { Customer } from '@prisma/client';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private toPublic(customer: Customer) {
    return {
      id: customer.id,
      name: customer.name,
      lastName: customer.lastName,
      specialty: customer.specialty,
      email: customer.email,
    };
  }

  private async signToken(customer: Customer) {
    const payload = {
      sub: customer.id,
      email: customer.email,
      name: customer.name,
      type: 'customer',
      tokenVersion: customer.tokenVersion,
    };
    return this.jwtService.signAsync(payload);
  }

  // Cierre de sesión real: incrementa tokenVersion → revoca todos los JWT del cliente.
  async logout(id: string) {
    await this.prisma.customer.update({
      where: { id },
      data: { tokenVersion: { increment: 1 } },
    });
    return { ok: true };
  }

  async register(dto: RegisterCustomerDto) {
    const existing = await this.prisma.customer.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con ese correo');
    }

    const hashedPassword = bcrypt.hashSync(dto.password, 10);

    const customer = await this.prisma.customer.create({
      data: {
        name: dto.name,
        lastName: dto.lastName,
        specialty: dto.specialty,
        email: dto.email,
        password: hashedPassword,
      },
    });

    // Correo de verificación (bienvenida + enlace). No rompe el registro si falla.
    try {
      const verifyToken = await this.jwtService.signAsync(
        { sub: customer.id, purpose: 'verify-email' },
        { expiresIn: '1d' },
      );
      const frontendUrl =
        this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
      const link = `${frontendUrl}/verificar?token=${verifyToken}`;
      await this.mail.sendVerifyEmail(customer.email, customer.name, link);
    } catch {
      // Ignorado: el envío de correo no debe afectar el registro.
    }

    const accessToken = await this.signToken(customer);
    return { access_token: accessToken, customer: this.toPublic(customer) };
  }

  // Verifica el correo del cliente a partir del token JWT del enlace.
  async verifyEmail(token: string) {
    let payload: { sub?: string; purpose?: string };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new BadRequestException('El enlace de verificación no es válido o expiró');
    }
    if (payload.purpose !== 'verify-email' || !payload.sub) {
      throw new BadRequestException('Enlace de verificación inválido');
    }
    const customer = await this.prisma.customer.findUnique({
      where: { id: payload.sub },
    });
    if (!customer) throw new BadRequestException('Cuenta no encontrada');

    const alreadyVerified = customer.emailVerified;
    if (!alreadyVerified) {
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { emailVerified: true },
      });
    }
    return { ok: true, alreadyVerified };
  }

  async login(dto: LoginCustomerDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { email: dto.email },
    });

    const passwordMatches =
      customer && bcrypt.compareSync(dto.password, customer.password);

    if (!customer || !passwordMatches) {
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    const accessToken = await this.signToken(customer);
    return { access_token: accessToken, customer: this.toPublic(customer) };
  }

  // Listado paginado para el panel admin (sin contraseñas), con búsqueda y
  // resumen de compras normalizado a USD. Evita cargar todo en memoria.
  async findAll(params?: { page?: number; limit?: number; search?: string }) {
    const page = params?.page && params.page >= 1 ? params.page : 1;
    const limit = params?.limit && params.limit >= 1 ? Math.min(params.limit, 100) : 20;

    const where: Prisma.CustomerWhereInput = {};
    const s = params?.search?.trim();
    if (s) {
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { specialty: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          lastName: true,
          email: true,
          specialty: true,
          createdAt: true,
          orders: {
            select: {
              total: true,
              status: true,
              currency: true,
              exchangeRateAtCreation: true,
            },
          },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    const items = customers.map((c) => {
      const paid = c.orders.filter((o) => o.status === 'PAID');
      // Total comprado en USD: convierte los pagos en Bs con su tasa histórica.
      const totalSpent = paid.reduce((sum, o) => {
        const t = Number(o.total);
        if (o.currency !== 'ves') return sum + t;
        const r = o.exchangeRateAtCreation ? Number(o.exchangeRateAtCreation) : 0;
        return sum + (r ? t / r : 0);
      }, 0);
      return {
        id: c.id,
        name: c.name,
        lastName: c.lastName,
        email: c.email,
        specialty: c.specialty,
        createdAt: c.createdAt,
        ordersCount: c.orders.length,
        paidOrdersCount: paid.length,
        totalSpent: Number(totalSpent.toFixed(2)),
      };
    });

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
  }

  // Detalle de un cliente con su historial de compras (admin).
  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        lastName: true,
        email: true,
        specialty: true,
        createdAt: true,
        orders: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            fulfillmentStatus: true,
            total: true,
            currency: true,
            paymentMethod: true,
            createdAt: true,
            items: { select: { id: true, name: true, unitPrice: true, quantity: true } },
          },
        },
      },
    });

    if (!customer) throw new NotFoundException('Cliente no encontrado');

    return {
      ...customer,
      orders: customer.orders.map((o) => ({
        ...o,
        total: Number(o.total),
        items: o.items.map((it) => ({ ...it, unitPrice: Number(it.unitPrice) })),
      })),
    };
  }

  // --- Perfil del cliente (sesión propia) ---

  private fullProfile(c: Customer) {
    return {
      id: c.id,
      name: c.name,
      lastName: c.lastName,
      specialty: c.specialty,
      phone: c.phone,
      clinicName: c.clinicName,
      idDocument: c.idDocument,
      address: c.address,
      city: c.city,
      billingAddress: c.billingAddress,
      billingCity: c.billingCity,
      billingState: c.billingState,
      shippingAddress: c.shippingAddress,
      shippingCity: c.shippingCity,
      shippingState: c.shippingState,
      email: c.email,
      createdAt: c.createdAt,
    };
  }

  async getMe(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Cliente no encontrado');
    return this.fullProfile(customer);
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    const customer = await this.prisma.customer.update({
      where: { id },
      data: { ...dto },
    });
    return this.fullProfile(customer);
  }

  async changePassword(id: string, dto: ChangePasswordDto) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Cliente no encontrado');
    if (!bcrypt.compareSync(dto.currentPassword, customer.password)) {
      throw new UnauthorizedException('La contraseña actual es incorrecta');
    }
    // Incrementa tokenVersion (revoca las DEMÁS sesiones) y devuelve un token
    // nuevo para mantener la sesión actual del cliente que cambia su contraseña.
    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        password: bcrypt.hashSync(dto.newPassword, 10),
        tokenVersion: { increment: 1 },
      },
    });
    const accessToken = await this.signToken(updated);
    return { changed: true, access_token: accessToken };
  }
}
