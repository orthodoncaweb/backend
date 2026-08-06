import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { AdminGuard } from '../auth/admin.guard';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

@UseGuards(AdminGuard)
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  // POST /api/upload  (multipart/form-data, campo "file")
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No se envió ningún archivo');
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('El archivo debe ser una imagen');
    }
    if (file.size > MAX_SIZE) {
      throw new BadRequestException('La imagen no debe superar los 5 MB');
    }
    return this.uploadService.upload(file);
  }
}
