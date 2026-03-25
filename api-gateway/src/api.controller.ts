import { Body, Controller, Post } from '@nestjs/common';
import { ApiService } from './api.service';

@Controller('auth/otp')
export class ApiController {
  constructor(private readonly apiService: ApiService) {}

  @Post('request')
  requestOtp(@Body() body: { phoneNumber: string }) {
    return this.apiService.forwardOtpRequest(body);
  }

  @Post('verify')
  verifyOtp(@Body() body: { phoneNumber: string; otpCode: string }) {
    return this.apiService.forwardOtpVerify(body);
  }
}
