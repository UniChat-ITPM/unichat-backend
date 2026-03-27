import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import axios, { AxiosError } from 'axios';

@Injectable()
export class ApiService {
  private readonly logger = new Logger(ApiService.name);

  private readonly otpServiceBaseUrl =
    process.env['OTP_SERVICE_URL'] ?? 'http://localhost:4228/api';

  private readonly authServiceBaseUrl =
    process.env['AUTH_SERVICE_URL'] ?? 'http://localhost:4226/api';

  private readonly userServiceBaseUrl =
    process.env['USER_SERVICE_URL'] ?? 'http://localhost:4227/api';

  async forwardOtpRequest(payload: { phoneNumber: string }) {
    const response = await axios.post(
      `${this.otpServiceBaseUrl}/otp/request`,
      payload,
    );
    return response.data;
  }

  async forwardOtpVerify(payload: { phoneNumber: string; otpCode: string }) {
    const response = await axios.post(
      `${this.authServiceBaseUrl}/auth/otp/verify`,
      payload,
    );
    return response.data;
  }

  async forwardCompleteProfile(payload: {
    phoneNumber: string;
    username: string;
    email: string;
    profilePhoto?: string;
  }) {
    try {
      const response = await axios.post(
        `${this.userServiceBaseUrl}/user/profile/complete`,
        payload,
        { maxBodyLength: 10 * 1024 * 1024 },
      );
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response) {
        const status = error.response.status;
        const message =
          error.response.data?.message ?? 'Profile completion failed';

        if (status === 409) {
          throw new ConflictException(message);
        }
        if (status === 400) {
          throw new BadRequestException(message);
        }

        this.logger.error(
          `user-service profile/complete responded with ${status}`,
        );
        throw new InternalServerErrorException(message);
      }

      const reason =
        error instanceof Error ? error.message : 'user-service unreachable';
      this.logger.error(`Failed to forward profile completion: ${reason}`);
      throw new InternalServerErrorException(
        'Unable to reach user service. Please try again.',
      );
    }
  }
}
