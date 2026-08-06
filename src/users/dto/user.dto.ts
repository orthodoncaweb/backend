import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsStrongPassword,
  MaxLength,
} from 'class-validator';
import { Role } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const STRONG = {
  minLength: 8,
  minLowercase: 1,
  minUppercase: 1,
  minNumbers: 1,
  minSymbols: 0,
};
const STRONG_MSG =
  'La contraseña debe tener al menos 8 caracteres, incluyendo mayúscula, minúscula y número';

/** Alta de un usuario del panel administrativo. */
export class CreateUserDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(80)
  name: string;

  @Transform(trimLower)
  @IsEmail({}, { message: 'El correo electrónico no es válido' })
  email: string;

  @IsStrongPassword(STRONG, { message: STRONG_MSG })
  password: string;

  @IsOptional()
  @IsEnum(Role, { message: 'El rol debe ser ADMIN o STAFF' })
  role?: Role;
}

/** Edición de un usuario (todos los campos opcionales). */
export class UpdateUserDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsEnum(Role, { message: 'El rol debe ser ADMIN o STAFF' })
  role?: Role;

  /** Si se envía, se restablece la contraseña de ese usuario. */
  @IsOptional()
  @IsStrongPassword(STRONG, { message: STRONG_MSG })
  password?: string;
}

/** Cambio de la contraseña propia (requiere la actual). */
export class ChangeOwnPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'La contraseña actual es obligatoria' })
  currentPassword: string;

  @IsStrongPassword(STRONG, { message: STRONG_MSG })
  newPassword: string;
}
