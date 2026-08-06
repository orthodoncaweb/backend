import { Module } from '@nestjs/common';
import { PriceSyncService } from './price-sync.service';
import { PricesController } from './prices.controller';

@Module({
  providers: [PriceSyncService],
  controllers: [PricesController],
})
export class PricesModule {}
