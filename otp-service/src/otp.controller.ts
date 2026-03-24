import { Body, Controller, Post } from '@nestjs/common';
import { OtpService } from './otp.service';

@Controller('otp')
export class OtpController {
  constructor(private readonly otpService: OtpService) {}

  @Post('request')
  requestOtp(
    @Body()
    body: {
      phoneNumber: string;
    },
  ) {
    return this.otpService.requestOtp(body.phoneNumber);
  }

  @Post('verify')
  verifyOtp(
    @Body()
    body: {
      phoneNumber: string;
      otpCode: string;
    },
  ) {
    return this.otpService.verifyOtp(body.phoneNumber, body.otpCode);
  }
}
