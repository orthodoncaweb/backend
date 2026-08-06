import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { CheckoutDto } from './dto/checkout.dto';
import { CustomerGuard } from '../auth/customer.guard';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // POST /api/checkout — requiere sesión de cliente. Crea la sesión de Stripe
  // y devuelve la URL de pago, asociando la orden al cliente autenticado.
  @UseGuards(CustomerGuard)
  @Post()
  create(@Req() req: { user: { id: string } }, @Body() dto: CheckoutDto) {
    return this.paymentsService.createCheckoutSession(dto, req.user.id);
  }

  // POST /api/checkout/whatsapp — crea el pedido (pago en bolívares) y devuelve
  // el enlace de WhatsApp con el mensaje prellenado. Requiere sesión de cliente.
  @UseGuards(CustomerGuard)
  @Post('whatsapp')
  whatsapp(@Req() req: { user: { id: string } }, @Body() dto: CheckoutDto) {
    return this.paymentsService.createWhatsappOrder(dto, req.user.id);
  }

  // GET /api/checkout/session/:id — confirma el pago al volver (sin webhook).
  @Get('session/:id')
  confirm(@Param('id') id: string) {
    return this.paymentsService.confirmSession(id);
  }

  // POST /api/checkout/webhook — Stripe notifica el resultado del pago.
  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    return this.paymentsService.handleWebhook(req.rawBody as Buffer, signature);
  }
}
