import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateProfileDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  specialty?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(140)
  clinicName?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  idDocument?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  // Facturación
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  billingAddress?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  billingCity?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  billingState?: string;

  // Envío
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  shippingAddress?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  shippingCity?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  shippingState?: string;
}
