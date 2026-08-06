import { IsString, IsNotEmpty, IsStrongPassword } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'La contraseña actual es obligatoria' })
  currentPassword: string;

  @IsStrongPassword(
    { minLength: 8, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 0 },
    {
      message:
        'La nueva contraseña debe tener al menos 8 caracteres, incluyendo mayúscula, minúscula y número',
    },
  )
  newPassword: string;
}
