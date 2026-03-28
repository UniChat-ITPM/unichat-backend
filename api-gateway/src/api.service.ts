import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
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

  async forwardUpdateUser(
    userId: string,
    payload: {
      displayName?: string;
      username?: string;
      email?: string;
      profilePhoto?: string;
    },
  ) {
    try {
      const response = await axios.put(
        `${this.userServiceBaseUrl}/user/${userId}`,
        payload,
        { maxBodyLength: 10 * 1024 * 1024 },
      );
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response) {
        const status = error.response.status;
        const message = error.response.data?.message ?? 'User update failed';

        if (status === 409) throw new ConflictException(message);
        if (status === 400) throw new BadRequestException(message);
        if (status === 404) throw new NotFoundException(message);

        this.logger.error(`user-service user/:id responded with ${status}`);
        throw new InternalServerErrorException(message);
      }

      const reason =
        error instanceof Error ? error.message : 'user-service unreachable';
      this.logger.error(`Failed to forward user update: ${reason}`);
      throw new InternalServerErrorException(
        'Unable to reach user service. Please try again.',
      );
    }
  }

  async forwardDeactivateUser(userId: string) {
    try {
      const response = await axios.put(
        `${this.userServiceBaseUrl}/user/${userId}/deactivate`,
      );
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response) {
        const status = error.response.status;
        const message = error.response.data?.message ?? 'User deactivation failed';

        if (status === 404) throw new NotFoundException(message);

        this.logger.error(`user-service user/:id/deactivate responded with ${status}`);
        throw new InternalServerErrorException(message);
      }

      const reason =
        error instanceof Error ? error.message : 'user-service unreachable';
      this.logger.error(`Failed to forward user deactivation: ${reason}`);
      throw new InternalServerErrorException(
        'Unable to reach user service. Please try again.',
      );
    }
  }

  async forwardFindUserByPhone(phoneNumber: string) {
    try {
      const response = await axios.get(
        `${this.userServiceBaseUrl}/user/find-by-phone`,
        { params: { phoneNumber } },
      );
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response) {
        const status = error.response.status;
        const message =
          error.response.data?.message ?? 'User lookup failed';

        if (status === 400) throw new BadRequestException(message);

        this.logger.error(
          `user-service find-by-phone responded with ${status}`,
        );
        throw new InternalServerErrorException(message);
      }

      const reason =
        error instanceof Error ? error.message : 'user-service unreachable';
      this.logger.error(`Failed to forward find-by-phone: ${reason}`);
      throw new InternalServerErrorException(
        'Unable to reach user service. Please try again.',
      );
    }
  }

  async forwardMatchContacts(
    requesterUserId: string,
    payload: { phoneNumbers: string[]; excludeSelf?: boolean },
  ) {
    try {
      const response = await axios.post(
        `${this.userServiceBaseUrl}/user/contacts/match`,
        payload,
        { headers: { 'x-user-id': requesterUserId } },
      );
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response) {
        const status = error.response.status;
        const message =
          error.response.data?.message ?? 'Contact matching failed';

        if (status === 400) throw new BadRequestException(message);
        if (status === 401) throw new UnauthorizedException(message);

        this.logger.error(
          `user-service contacts/match responded with ${status}`,
        );
        throw new InternalServerErrorException(message);
      }

      const reason =
        error instanceof Error ? error.message : 'user-service unreachable';
      this.logger.error(`Failed to forward contact match: ${reason}`);
      throw new InternalServerErrorException(
        'Unable to reach user service. Please try again.',
      );
    }
  }

  async forwardCreateUser(body: { phoneNumber: string }) {
    try {
      const response = await axios.post(
        `${this.userServiceBaseUrl}/user/create`,
        body,
      );
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response) {
        const status = error.response.status;
        const message =
          error.response.data?.message ?? 'User creation failed';

        if (status === 400) throw new BadRequestException(message);

        this.logger.error(`user-service create responded with ${status}`);
        throw new InternalServerErrorException(message);
      }

      const reason =
        error instanceof Error ? error.message : 'user-service unreachable';
      this.logger.error(`Failed to forward user create: ${reason}`);
      throw new InternalServerErrorException(
        'Unable to reach user service. Please try again.',
      );
    }
  }
}
