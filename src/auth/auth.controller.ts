import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /api/auth/login
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  // GET /api/auth/profile  (requiere JWT)
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  profile(@Req() req: { user: unknown }) {
    return req.user;
  }

  // POST /api/auth/logout — cierre de sesión real (revoca los JWT del admin).
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Req() req: { user: { id: string } }) {
    return this.authService.logout(req.user.id);
  }
}
