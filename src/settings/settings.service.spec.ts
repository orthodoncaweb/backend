import { SettingsService } from './settings.service';

// Test unitario plano: PrismaService mockeado como objeto con jest.fn().
describe('SettingsService', () => {
  let service: SettingsService;
  let prisma: { setting: { findUnique: jest.Mock; upsert: jest.Mock } };

  beforeEach(() => {
    prisma = {
      setting: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
    };
    service = new SettingsService(prisma as any);
  });

  describe('get', () => {
    it('devuelve el value cuando existe el setting', async () => {
      prisma.setting.findUnique.mockResolvedValue({ key: 'k', value: 'v' });

      const result = await service.get('k');

      expect(prisma.setting.findUnique).toHaveBeenCalledWith({ where: { key: 'k' } });
      expect(result).toBe('v');
    });

    it('devuelve null cuando el setting no existe', async () => {
      prisma.setting.findUnique.mockResolvedValue(null);
      expect(await service.get('missing')).toBeNull();
    });

    it('devuelve null cuando el value es null/undefined (?? null)', async () => {
      prisma.setting.findUnique.mockResolvedValue({ key: 'k', value: null });
      expect(await service.get('k')).toBeNull();
    });
  });

  describe('set', () => {
    it('hace upsert (update+create) y devuelve { key, value }', async () => {
      const result = await service.set('k', 'v');

      expect(prisma.setting.upsert).toHaveBeenCalledWith({
        where: { key: 'k' },
        update: { value: 'v' },
        create: { key: 'k', value: 'v' },
      });
      expect(result).toEqual({ key: 'k', value: 'v' });
    });
  });

  describe('whatsapp helpers', () => {
    it('getWhatsapp lee la clave whatsapp_number', async () => {
      prisma.setting.findUnique.mockResolvedValue({ key: 'whatsapp_number', value: '+58 412' });

      const result = await service.getWhatsapp();

      expect(prisma.setting.findUnique).toHaveBeenCalledWith({
        where: { key: 'whatsapp_number' },
      });
      expect(result).toBe('+58 412');
    });

    it('setWhatsapp guarda bajo la clave whatsapp_number', async () => {
      const result = await service.setWhatsapp('+58 412-1234567');

      expect(prisma.setting.upsert).toHaveBeenCalledWith({
        where: { key: 'whatsapp_number' },
        update: { value: '+58 412-1234567' },
        create: { key: 'whatsapp_number', value: '+58 412-1234567' },
      });
      expect(result).toEqual({ key: 'whatsapp_number', value: '+58 412-1234567' });
    });
  });
});
