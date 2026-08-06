import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { AdminGuard } from '../auth/admin.guard';

@UseGuards(AdminGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // Admin: GET /api/orders?page=&limit=&status=&fulfillmentStatus=&search=
  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('fulfillmentStatus') fulfillmentStatus?: string,
    @Query('search') search?: string,
  ) {
    return this.paymentsService.findAllOrders({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status,
      fulfillmentStatus,
      search,
    });
  }

  // Admin: GET /api/orders/:id (detalle)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOrder(id);
  }

  // Admin: PATCH /api/orders/:id (estado de pago/atención, seguimiento y notas)
  @Patch(':id')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.paymentsService.updateOrder(id, dto);
  }
}
