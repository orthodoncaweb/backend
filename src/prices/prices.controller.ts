import { Controller, Post, UseGuards } from '@nestjs/common';
import { PriceSyncService } from './price-sync.service';
import { AdminGuard } from '../auth/admin.guard';

@UseGuards(AdminGuard)
@Controller('prices')
export class PricesController {
  constructor(private readonly priceSyncService: PriceSyncService) {}

  // Admin: POST /api/prices/sync — dispara la verificación manualmente (pruebas).
  @Post('sync')
  sync() {
    return this.priceSyncService.syncPrices();
  }
}
