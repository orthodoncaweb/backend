import { UploadService } from './upload.service';
import { mkdir, writeFile } from 'fs/promises';

// Mock del send() de S3. Debe llevar el prefijo "mock" para poder referenciarse
// dentro de la factory hoisteada de jest.mock.
const mockS3Send = jest.fn().mockResolvedValue(undefined);

// Mockeamos el sistema de archivos y el cliente S3 para no tocar disco ni red.
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

describe('UploadService', () => {
  beforeEach(() => {
    (mkdir as jest.Mock).mockClear();
    (writeFile as jest.Mock).mockClear();
    mockS3Send.mockClear();
  });

  function makeConfig(values: Record<string, string | undefined>) {
    return { get: jest.fn((key: string) => values[key]) };
  }

  const file = {
    originalname: 'foto.PNG',
    buffer: Buffer.from('bytes'),
    mimetype: 'image/png',
  } as any;

  describe('almacenamiento local (R2 no configurado)', () => {
    it('usingR2 es false y guarda en disco devolviendo una URL local', async () => {
      const service = new UploadService(
        makeConfig({ PUBLIC_BACKEND_URL: 'http://localhost:4000' }) as any,
      );

      expect(service.usingR2).toBe(false);

      const result = await service.upload(file);

      expect(mkdir).toHaveBeenCalledTimes(1);
      expect(writeFile).toHaveBeenCalledTimes(1);
      expect(mockS3Send).not.toHaveBeenCalled();
      expect(result.storage).toBe('local');
      // Extensión en minúsculas y URL bajo /uploads.
      expect(result.url).toMatch(/^http:\/\/localhost:4000\/uploads\/.+\.png$/);
    });

    it('usa el fallback http://localhost:4000 cuando PUBLIC_BACKEND_URL no está', async () => {
      const service = new UploadService(makeConfig({}) as any);
      const result = await service.upload(file);
      expect(result.url).toContain('http://localhost:4000/uploads/');
    });
  });

  describe('almacenamiento R2 (configurado)', () => {
    const r2Config = {
      R2_ACCOUNT_ID: 'acc',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'bucket',
      R2_PUBLIC_URL: 'https://cdn.test/',
    };

    it('usingR2 es true y sube a R2 devolviendo la URL pública', async () => {
      const service = new UploadService(makeConfig(r2Config) as any);

      expect(service.usingR2).toBe(true);

      const result = await service.upload(file);

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      expect(writeFile).not.toHaveBeenCalled();
      expect(result.storage).toBe('r2');
      // Se recorta la barra final del public URL y la key va bajo categories/.
      expect(result.url).toMatch(/^https:\/\/cdn\.test\/categories\/.+\.png$/);
    });
  });
});
