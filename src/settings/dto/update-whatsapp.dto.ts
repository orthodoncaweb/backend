import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';

export class UpdateWhatsappDto {
  // Número con código de país (ej. 584241234567). Se sanea al usarlo.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(30)
  number: string;
}
