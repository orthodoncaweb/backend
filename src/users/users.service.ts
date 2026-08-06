import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

// Campos que se exponen del usuario (nunca la contraseña).
const publicSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Listado del personal del panel (sin contraseñas). */
  findAll() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: publicSelect,
    });
  }

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Ya existe un usuario con ese correo');
    }

    return this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: bcrypt.hashSync(dto.password, 10),
        role: dto.role ?? Role.ADMIN,
      },
      select: publicSelect,
    });
  }

  async update(id: string, dto: UpdateUserDto, requesterId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // No permitir quitarse a uno mismo el rol de admin si es el último.
    if (dto.role && dto.role !== Role.ADMIN && user.role === Role.ADMIN) {
      await this.assertNotLastAdmin(id);
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.password) {
      // Restablecer la contraseña revoca las sesiones abiertas de ese usuario.
      data.password = bcrypt.hashSync(dto.password, 10);
      data.tokenVersion = { increment: 1 };
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: publicSelect,
    });
  }

  async remove(id: string, requesterId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (id === requesterId) {
      throw new BadRequestException('No puedes eliminar tu propio usuario');
    }
    if (user.role === Role.ADMIN) {
      await this.assertNotLastAdmin(id);
    }

    await this.prisma.user.delete({ where: { id } });
    return { deleted: true };
  }

  /** Evita quedarse sin ningún administrador en el sistema. */
  private async assertNotLastAdmin(id: string) {
    const otherAdmins = await this.prisma.user.count({
      where: { role: Role.ADMIN, id: { not: id } },
    });
    if (otherAdmins === 0) {
      throw new BadRequestException(
        'Debe existir al menos un administrador. Asigna el rol de administrador a otro usuario primero.',
      );
    }
  }
}
