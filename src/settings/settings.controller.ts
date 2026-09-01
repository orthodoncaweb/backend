import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateWhatsappDto } from './dto/update-whatsapp.dto';
import { UpdateBsFactorDto } from './dto/update-bs-factor.dto';
import { AdminGuard } from '../auth/admin.guard';

@UseGuards(AdminGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  // Admin: GET /api/settings/whatsapp
  @Get('whatsapp')
  async getWhatsapp() {
    return { number: await this.settings.getWhatsapp() };
  }

  // Admin: PATCH /api/settings/whatsapp
  @Patch('whatsapp')
  async setWhatsapp(@Body() dto: UpdateWhatsappDto) {
    await this.settings.setWhatsapp(dto.number);
    return { number: dto.number };
  }

  // Admin: GET /api/settings/bs-factor — factor de conversión a bolívares.
  @Get('bs-factor')
  async getBsFactor() {
    return { factor: await this.settings.getBsFactor() };
  }

  // Admin: PATCH /api/settings/bs-factor
  @Patch('bs-factor')
  async setBsFactor(@Body() dto: UpdateBsFactorDto) {
    return { factor: await this.settings.setBsFactor(dto.factor) };
  }
}
