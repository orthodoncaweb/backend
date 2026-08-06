import { IsIn } from 'class-validator';

export class UpdateRateTypeDto {
  @IsIn(['USD', 'EUR'], { message: 'El tipo debe ser USD o EUR' })
  type: 'USD' | 'EUR';
}
