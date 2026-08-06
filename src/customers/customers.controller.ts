import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { LoginCustomerDto } from './dto/login-customer.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AdminGuard } from '../auth/admin.guard';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  // POST /api/customers/register
  @Post('register')
  register(@Body() dto: RegisterCustomerDto) {
    return this.customersService.register(dto);
  }

  // POST /api/customers/login
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginCustomerDto) {
    return this.customersService.login(dto);
  }

  // POST /api/customers/verify-email — confirma el correo desde el enlace.
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.customersService.verifyEmail(dto.token);
  }

  // Admin: GET /api/customers?page=&limit=&search= — listado paginado.
  @UseGuards(AdminGuard)
  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.customersService.findAll({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search,
    });
  }

  // Admin: GET /api/customers/:id — detalle con historial de compras.
  @UseGuards(AdminGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }
}
