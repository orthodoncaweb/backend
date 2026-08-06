import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Atributo del selector de variantes, ej. { name: 'Slot', values: ['.018"', '.022"'] }
export class ProductAttributeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @IsArray()
  @IsString({ each: true })
  values: string[];
}

// Variante de un producto con su propio precio/stock.
export class ProductVariantDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  id?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'La etiqueta de la variante es obligatoria' })
  @MaxLength(200)
  label: string;

  // Selección de atributos, ej. { Slot: '.022"', Arcada: 'Superior' }
  @IsObject()
  options: Record<string, string>;

  @Type(() => Number)
  @IsNumber({}, { message: 'El precio de la variante debe ser un número' })
  @Min(0, { message: 'El precio no puede ser negativo' })
  price: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @Transform(trim)
  @IsOptional()
  @IsString()
  image?: string;
}

export class CreateProductDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(160)
  name: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'El SKU es obligatorio' })
  @MaxLength(60)
  sku: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'El precio debe ser un número' })
  @Min(0, { message: 'El precio no puede ser negativo' })
  price: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'La categoría es obligatoria' })
  categoryId: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  subcategoryId?: string;

  @IsOptional()
  hasVariants?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductAttributeDto)
  attributes?: ProductAttributeDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants?: ProductVariantDto[];
}

export class UpdateProductDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  sku?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber({}, { message: 'El precio debe ser un número' })
  @Min(0, { message: 'El precio no puede ser negativo' })
  price?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  categoryId?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  subcategoryId?: string | null;

  @IsOptional()
  hasVariants?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductAttributeDto)
  attributes?: ProductAttributeDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants?: ProductVariantDto[];
}
