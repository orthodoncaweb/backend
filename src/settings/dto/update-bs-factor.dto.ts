import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';
import { BS_FACTOR_MAX, BS_FACTOR_MIN } from '../settings.service';

export class UpdateBsFactorDto {
  // Multiplicador sobre el precio en dólares para el pago en bolívares.
  // Ej: 1.176 -> un producto de $100 se cotiza como $117.60 antes de aplicar la tasa.
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(BS_FACTOR_MIN)
  @Max(BS_FACTOR_MAX)
  factor: number;
}
