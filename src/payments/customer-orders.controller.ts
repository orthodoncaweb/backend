import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CustomerGuard } from '../auth/customer.guard';

@UseGuards(CustomerGuard)
@Controller('me')
export class CustomerOrdersController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // Cliente: GET /api/me/orders
  @Get('orders')
  myOrders(@Req() req: { user: { id: string } }) {
    return this.paymentsService.findCustomerOrders(req.user.id);
  }
}
