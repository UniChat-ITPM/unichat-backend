import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, OtpChannel, OtpPurpose, OtpStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomInt } from 'crypto';
import axios from 'axios';

@Injectable()
export class AuthService implements OnModuleDestroy {
  private readonly logger = new Logger(AuthService.name);
  private readonly prisma: PrismaClient;

  private static readonly OTP_LENGTH = 6;
  private static readonly OTP_EXPIRES_MS = 5 * 60_000;
  private static readonly MAX_VERIFY_ATTEMPTS = 5;

  private readonly userServiceBaseUrl =
    process.env['USER_SERVICE_URL'] ?? 'http://localhost:4227/api';

  constructor() {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required to initialize Prisma');
    }

    const adapter = new PrismaPg({ connectionString: databaseUrl });
    this.prisma = new PrismaClient({ adapter });
  }

  // ─── OTP Generation (called by otp-service) ───────────────────────

  async generateOtp(
    phoneNumber: string,
    purpose: 'LOGIN' | string,
  ): Promise<
    | { success: true; otpCode: string; requestId: string; expiresAt: Date }
    | { success: false; message: string }
  > {
    const normalizedPhone = this.normalizeAndValidatePhone(phoneNumber);

    const otpPurpose = this.toOtpPurpose(purpose);
    const otpCode = this.generateOtpCode();
    const otpHash = this.hashOtp(otpCode);

    const otpRecord = await this.prisma.otpRequest.create({
      data: {
        phoneNumber: normalizedPhone,
        otpCodeHash: otpHash,
        channel: OtpChannel.WHATSAPP,
        purpose: otpPurpose,
        status: OtpStatus.PENDING,
        attempts: 0,
        maxAttempts: AuthService.MAX_VERIFY_ATTEMPTS,
        expiresAt: new Date(Date.now() + AuthService.OTP_EXPIRES_MS),
      },
    });

    return {
      success: true,
      otpCode,
      requestId: otpRecord.id,
      expiresAt: otpRecord.expiresAt,
    };
  }

  // ─── OTP Verification + User lookup/create ─────────────────────────

  async verifyOtpAndLogin(
    phoneNumber: string,
    otpCode: string,
  ): Promise<
    | {
        success: true;
        message: string;
        isNewUser: boolean;
        user: {
          id: string;
          phoneNumber: string;
          displayName: string;
          username?: string | null;
        };
      }
    | { success: false; message: string }
  > {
    const normalizedPhone = this.normalizeAndValidatePhone(phoneNumber);
    this.validateOtpFormat(otpCode);

    // 1) Find latest active OTP
    const latestOtp = await this.prisma.otpRequest.findFirst({
      where: {
        phoneNumber: normalizedPhone,
        purpose: OtpPurpose.LOGIN,
        status: { in: [OtpStatus.PENDING, OtpStatus.SENT] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestOtp) {
      return {
        success: false,
        message: 'No active OTP found. Please request a new OTP.',
      };
    }

    // 2) Check expiry
    if (latestOtp.expiresAt.getTime() < Date.now()) {
      await this.prisma.otpRequest.update({
        where: { id: latestOtp.id },
        data: { status: OtpStatus.FAILED, failureReason: 'OTP expired' },
      });
      return {
        success: false,
        message: 'OTP expired. Please request a new OTP.',
      };
    }

    // 3) Compare hash
    const incomingHash = this.hashOtp(otpCode);
    if (incomingHash !== latestOtp.otpCodeHash) {
      const attempts = latestOtp.attempts + 1;
      await this.prisma.otpRequest.update({
        where: { id: latestOtp.id },
        data: {
          attempts,
          failureReason: 'Invalid OTP',
          status:
            attempts >= latestOtp.maxAttempts
              ? OtpStatus.FAILED
              : latestOtp.status,
        },
      });
      return { success: false, message: 'Invalid OTP' };
    }

    // 4) Mark OTP as verified
    await this.prisma.otpRequest.update({
      where: { id: latestOtp.id },
      data: {
        status: OtpStatus.VERIFIED,
        verifiedAt: new Date(),
        failureReason: null,
      },
    });

    // 5) Check if user exists via user-service
    let isNewUser = false;
    let user: {
      id: string;
      phoneNumber: string;
      displayName: string;
      username?: string | null;
    };

    try {
      const findResponse = await axios.get(
        `${this.userServiceBaseUrl}/user/find-by-phone`,
        { params: { phoneNumber: normalizedPhone } },
      );

      if (findResponse.data?.found) {
        // Existing user → return display name
        user = findResponse.data.user;
        this.logger.log(
          `Existing user found for ${normalizedPhone}: ${user.displayName}`,
        );
      } else {
        // New user → request user-service to create
        const createResponse = await axios.post(
          `${this.userServiceBaseUrl}/user/create`,
          { phoneNumber: normalizedPhone },
        );
        user = createResponse.data.user;
        isNewUser = true;
        this.logger.log(`New user created for ${normalizedPhone} via user-service`);
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'user-service call failed';
      this.logger.error(`Failed to resolve user: ${reason}`);
      return {
        success: false,
        message: 'OTP verified but failed to resolve user account. Please try again.',
      };
    }

    return {
      success: true,
      message: isNewUser
        ? 'Login success. Welcome to UniChat!'
        : `Login success. Welcome back, ${user.displayName}!`,
      isNewUser,
      user,
    };
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private normalizeAndValidatePhone(phoneNumber: string): string {
    const normalized = phoneNumber.trim().replace(/\s+/g, '');
    const e164Pattern = /^\+[1-9]\d{7,14}$/;
    if (!e164Pattern.test(normalized)) {
      throw new Error(
        'Phone number must be in E.164 format, e.g. +94771234567',
      );
    }
    return normalized;
  }

  private validateOtpFormat(otpCode: string) {
    if (!new RegExp(`^\\d{${AuthService.OTP_LENGTH}}$`).test(otpCode)) {
      throw new Error('OTP must be a 6 digit number');
    }
  }

  private generateOtpCode(): string {
    const upper = 10 ** AuthService.OTP_LENGTH;
    const value = randomInt(0, upper);
    return value.toString().padStart(AuthService.OTP_LENGTH, '0');
  }

  private hashOtp(otpCode: string): string {
    const pepper = process.env['OTP_HASH_PEPPER'] ?? '';
    return createHash('sha256').update(`${otpCode}:${pepper}`).digest('hex');
  }

  private toOtpPurpose(purpose: string): OtpPurpose {
    const normalized = purpose.toUpperCase();
    if (
      normalized === OtpPurpose.LOGIN ||
      normalized === OtpPurpose.REGISTER ||
      normalized === OtpPurpose.PHONE_VERIFICATION ||
      normalized === OtpPurpose.RESET_PASSWORD
    ) {
      return normalized as OtpPurpose;
    }
    return OtpPurpose.LOGIN;
  }
}
