import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import { mkdir, writeFile } from 'fs/promises';

export interface UploadResult {
  url: string;
  storage: 'r2' | 'local';
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  private readonly s3?: S3Client;
  private readonly bucket?: string;
  private readonly r2PublicUrl?: string;
  private readonly publicBackendUrl: string;
  private readonly uploadsDir = join(process.cwd(), 'uploads');

  constructor(private readonly config: ConfigService) {
    const accountId = this.config.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY');
    this.bucket = this.config.get<string>('R2_BUCKET');
    this.r2PublicUrl = this.config.get<string>('R2_PUBLIC_URL');
    this.publicBackendUrl =
      this.config.get<string>('PUBLIC_BACKEND_URL') ?? 'http://localhost:4000';

    if (accountId && accessKeyId && secretAccessKey && this.bucket && this.r2PublicUrl) {
      this.s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
      this.logger.log('Almacenamiento de imágenes: Cloudflare R2');
    } else {
      this.logger.log('Almacenamiento de imágenes: local (R2 no configurado)');
    }
  }

  get usingR2(): boolean {
    return Boolean(this.s3);
  }

  async upload(file: Express.Multer.File): Promise<UploadResult> {
    const ext = extname(file.originalname).toLowerCase() || '.png';
    const filename = `${randomUUID()}${ext}`;
    const key = `categories/${filename}`;

    // R2 (si está configurado)
    if (this.s3 && this.bucket && this.r2PublicUrl) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );
      const base = this.r2PublicUrl.replace(/\/$/, '');
      return { url: `${base}/${key}`, storage: 'r2' };
    }

    // Fallback local: guarda en backend/uploads y se sirve en /uploads
    await mkdir(this.uploadsDir, { recursive: true });
    await writeFile(join(this.uploadsDir, filename), file.buffer);
    const base = this.publicBackendUrl.replace(/\/$/, '');
    return { url: `${base}/uploads/${filename}`, storage: 'local' };
  }
}
