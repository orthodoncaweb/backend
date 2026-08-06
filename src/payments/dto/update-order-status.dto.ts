import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { FulfillmentStatus } from '@prisma/client';

export class UpdateOrderStatusDto {
  // Estado de atención (RECIBIDO|EN_PREPARACION|ENVIADO)
  @IsOptional()
  @IsEnum(FulfillmentStatus, {
    message: 'Estado de atención no válido',
  })
  fulfillmentStatus?: FulfillmentStatus;

  // Estado de pago
  @IsOptional()
  @IsIn(['PENDING', 'PAID', 'FAILED', 'CANCELED'], {
    message: 'Estado de pago no válido',
  })
  status?: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED';

  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  adminNotes?: string;
}
