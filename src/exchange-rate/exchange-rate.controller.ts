import { Body, Controller, Get, Header, Patch, Post, UseGuards } from '@nestjs/common';
import { ExchangeRateService } from './exchange-rate.service';
import { UpdateRateTypeDto } from './dto/update-rate-type.dto';
import { AdminGuard } from '../auth/admin.guard';

@Controller('exchange-rate')
export class ExchangeRateController {
  constructor(private readonly exchangeRateService: ExchangeRateService) {}

  // Público: GET /api/exchange-rate — tasa actual para el storefront.
  @Get()
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=300')
  getRate() {
    return this.exchangeRateService.getRate();
  }

  // Admin: GET /api/exchange-rate/config — tipo configurado.
  @UseGuards(AdminGuard)
  @Get('config')
  async getConfig() {
    return { type: await this.exchangeRateService.getType() };
  }

  // Admin: PATCH /api/exchange-rate/config — cambiar el tipo de tasa.
  @UseGuards(AdminGuard)
  @Patch('config')
  setConfig(@Body() dto: UpdateRateTypeDto) {
    return this.exchangeRateService.setType(dto.type);
  }

  // Admin: GET /api/exchange-rate/history — historial diario.
  @UseGuards(AdminGuard)
  @Get('history')
  getHistory() {
    return this.exchangeRateService.getHistory();
  }

  // Admin: POST /api/exchange-rate/record — registra la tasa de hoy (manual).
  @UseGuards(AdminGuard)
  @Post('record')
  record() {
    return this.exchangeRateService.recordDailyRate();
  }
}
