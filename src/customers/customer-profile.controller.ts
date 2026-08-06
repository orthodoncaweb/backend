import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CustomerGuard } from '../auth/customer.guard';

@UseGuards(CustomerGuard)
@Controller('me')
export class CustomerProfileController {
  constructor(private readonly customersService: CustomersService) {}

  // POST /api/me/logout — cierre de sesión real (revoca los JWT del cliente).
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Req() req: { user: { id: string } }) {
    return this.customersService.logout(req.user.id);
  }

  // GET /api/me/profile
  @Get('profile')
  getProfile(@Req() req: { user: { id: string } }) {
    return this.customersService.getMe(req.user.id);
  }

  // PATCH /api/me/profile
  @Patch('profile')
  updateProfile(@Req() req: { user: { id: string } }, @Body() dto: UpdateProfileDto) {
    return this.customersService.updateProfile(req.user.id, dto);
  }

  // PATCH /api/me/password
  @Patch('password')
  @HttpCode(HttpStatus.OK)
  changePassword(@Req() req: { user: { id: string } }, @Body() dto: ChangePasswordDto) {
    return this.customersService.changePassword(req.user.id, dto);
  }
}
