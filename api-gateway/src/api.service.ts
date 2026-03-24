import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class ApiService {
  private readonly otpServiceBaseUrl =
    process.env['OTP_SERVICE_URL'] ?? 'http://localhost:4228/api';

  async forwardOtpRequest(payload: { phoneNumber: string }) {
    const response = await axios.post(
      `${this.otpServiceBaseUrl}/otp/request`,
      payload,
    );
    return response.data;
  }

  async forwardOtpVerify(payload: { phoneNumber: string; otpCode: string }) {
    const response = await axios.post(
      `${this.otpServiceBaseUrl}/otp/verify`,
      payload,
    );
    return response.data;
  }
}
