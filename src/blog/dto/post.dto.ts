import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePostDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'El título es obligatorio' })
  @MaxLength(200)
  title: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'El contenido es obligatorio' })
  content: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverImage?: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

export class UpdatePostDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  content?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverImage?: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
