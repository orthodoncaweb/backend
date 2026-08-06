import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

// Métodos de pago disponibles (Stripe deshabilitado temporalmente). Todos
// generan el pedido y se coordinan por WhatsApp.
export const WHATSAPP_PAYMENT_METHODS = [
  'transferencia_usd',
  'zelle',
  'transferencia_bs',
  'pago_movil',
] as const;

export class CheckoutItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  // Variante seleccionada (productos con variantes)
  @IsString()
  @IsOptional()
  variantId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;
}

// Datos de envío opcionales del pedido
export class ShippingDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  name?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  phone?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  idDocument?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  address?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  city?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CheckoutDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'El carrito está vacío' })
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items: CheckoutItemDto[];

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsOptional()
  @IsEmail()
  email?: string;

  @ValidateNested()
  @Type(() => ShippingDto)
  @IsOptional()
  shipping?: ShippingDto;

  // Método de pago elegido para el pedido por WhatsApp.
  @IsOptional()
  @IsIn(WHATSAPP_PAYMENT_METHODS)
  paymentMethod?: string;
}
