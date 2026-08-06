import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const WHATSAPP_KEY = 'whatsapp_number';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(key: string): Promise<string | null> {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    return setting?.value ?? null;
  }

  async set(key: string, value: string) {
    await this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    return { key, value };
  }

  getWhatsapp() {
    return this.get(WHATSAPP_KEY);
  }

  setWhatsapp(number: string) {
    return this.set(WHATSAPP_KEY, number);
  }
}
