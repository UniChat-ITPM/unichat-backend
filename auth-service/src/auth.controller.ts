import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('otp/generate')
  generateOtp(
    @Body() body: { phoneNumber: string; purpose?: 'LOGIN' },
  ) {
    return this.authService.generateOtp(body.phoneNumber, body.purpose ?? 'LOGIN');
  }

  @Post('otp/verify')
  verifyOtp(
    @Body() body: { phoneNumber: string; otpCode: string },
  ) {
    return this.authService.verifyOtpAndLogin(body.phoneNumber, body.otpCode);
  }
}
