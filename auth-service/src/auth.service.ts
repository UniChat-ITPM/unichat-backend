import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, OtpChannel, OtpPurpose, OtpStatus, UserStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomInt } from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly prisma: PrismaClient;

  private static readonly OTP_LENGTH = 6;
  private static readonly OTP_EXPIRES_MS = 5 * 60_000;
  private static readonly MAX_VERIFY_ATTEMPTS = 5;

  constructor() {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required to initialize Prisma');
    }

    const adapter = new PrismaPg({ connectionString: databaseUrl });
    this.prisma = new PrismaClient({ adapter });
  }

  async generateOtp(
    phoneNumber: string,
    purpose: 'LOGIN' | string,
  ): Promise<{
    success: true;
    otpCode: string;
    requestId: string;
    expiresAt: Date;
  } | { success: false; message: string }> {
    const normalizedPhone = this.normalizeAndValidatePhone(phoneNumber);

    // For this MVP we only support LOGIN purpose.
    const otpPurpose = (purpose === 'LOGIN' ? OtpPurpose.LOGIN : OtpPurpose.LOGIN) as OtpPurpose;

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

  async verifyOtpAndLogin(
    phoneNumber: string,
    otpCode: string,
  ): Promise<{ success: true; message: string; user: { id: string; phoneNumber: string; displayName: string; username?: string | null } } | { success: false; message: string }> {
    const normalizedPhone = this.normalizeAndValidatePhone(phoneNumber);
    this.validateOtpFormat(otpCode);

    const latestOtp = await this.prisma.otpRequest.findFirst({
      where: {
        phoneNumber: normalizedPhone,
        purpose: OtpPurpose.LOGIN,
        status: { in: [OtpStatus.PENDING, OtpStatus.SENT] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestOtp) {
      return { success: false, message: 'No active OTP found. Please request a new OTP.' };
    }

    if (latestOtp.expiresAt.getTime() < Date.now()) {
      await this.prisma.otpRequest.update({
        where: { id: latestOtp.id },
        data: { status: OtpStatus.FAILED, failureReason: 'OTP expired' },
      });
      return { success: false, message: 'OTP expired. Please request a new OTP.' };
    }

    const incomingHash = this.hashOtp(otpCode);
    if (incomingHash !== latestOtp.otpCodeHash) {
      const attempts = latestOtp.attempts + 1;
      await this.prisma.otpRequest.update({
        where: { id: latestOtp.id },
        data: {
          attempts,
          failureReason: 'Invalid OTP',
          status: attempts >= latestOtp.maxAttempts ? OtpStatus.FAILED : latestOtp.status,
        },
      });
      return { success: false, message: 'Invalid OTP' };
    }

    await this.prisma.otpRequest.update({
      where: { id: latestOtp.id },
      data: { status: OtpStatus.VERIFIED, verifiedAt: new Date(), failureReason: null },
    });

    // Create or update user on first successful login.
    const existingUser = await this.prisma.user.findUnique({
      where: { phoneNumber: normalizedPhone },
    });

    const user =
      existingUser ??
      (await this.prisma.user.create({
        data: {
          phoneNumber: normalizedPhone,
          phoneVerified: true,
          displayName: normalizedPhone,
          status: UserStatus.ACTIVE,
        },
      }));

    if (!existingUser) {
      this.logger.log(`Created new user for phone ${normalizedPhone}`);
    }

    return {
      success: true,
      message: 'Login success',
      user: {
        id: user.id,
        phoneNumber: user.phoneNumber,
        displayName: user.displayName,
        username: user.username,
      },
    };
  }

  private normalizeAndValidatePhone(phoneNumber: string): string {
    const normalized = phoneNumber.trim().replace(/\s+/g, '');
    const e164Pattern = /^\+[1-9]\d{7,14}$/;
    if (!e164Pattern.test(normalized)) {
      throw new Error('Phone number must be in E.164 format, e.g. +94771234567');
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
}
