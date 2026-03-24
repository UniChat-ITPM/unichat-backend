import { Injectable, OnModuleInit } from '@nestjs/common';
import { OtpStatus } from '@prisma/client';
import { createHash, randomInt } from 'crypto';
import { NotificationLogRepository } from './repositories/notification-log.repository';
import { WhatsappProviderService } from './providers/whatsapp-provider.service';
import { NotificationChannel } from './types/notification.types';

@Injectable()
export class OtpService implements OnModuleInit {
  private static readonly OTP_LENGTH = 6;
  private static readonly OTP_EXPIRES_MS = 5 * 60_000;
  private static readonly MAX_VERIFY_ATTEMPTS = 5;

  constructor(
    private readonly logs: NotificationLogRepository,
    private readonly whatsappProvider: WhatsappProviderService,
  ) {}

  async onModuleInit() {
    await this.whatsappProvider.initialize();
  }

  async requestOtp(phoneNumber: string) {
    const normalizedPhone = this.normalizeAndValidatePhone(phoneNumber);

    const isRegisteredWhatsappUser =
      await this.whatsappProvider.isWhatsappUser(normalizedPhone);
    if (!isRegisteredWhatsappUser) {
      return {
        success: false,
        message: 'Provided mobile number is not available on WhatsApp',
      };
    }

    const otpCode = this.generateOtp();
    const otpHash = this.hashOtp(otpCode);

    const otpRecord = await this.logs.createOtpRequest({
      phoneNumber: normalizedPhone,
      otpHash,
      expiresAt: new Date(Date.now() + OtpService.OTP_EXPIRES_MS),
      maxAttempts: OtpService.MAX_VERIFY_ATTEMPTS,
      channel: NotificationChannel.WHATSAPP,
      purpose: 'LOGIN',
    });

    const messageBody = `Your UniChat OTP is ${otpCode}. It will expire in 5 minutes.`;

    try {
      const providerMessageId = await this.whatsappProvider.sendMessage(
        normalizedPhone,
        messageBody,
      );
      await this.logs.markSent(otpRecord.id, providerMessageId);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Failed to send OTP on WhatsApp';
      await this.logs.markFailed(otpRecord.id, reason);
      return {
        success: false,
        message: 'OTP generation succeeded but WhatsApp delivery failed',
      };
    }

    return {
      success: true,
      message: 'OTP sent successfully',
      otpCode,
      requestId: otpRecord.id,
      expiresAt: otpRecord.expiresAt,
    };
  }

  async verifyOtp(phoneNumber: string, otpCode: string) {
    const normalizedPhone = this.normalizeAndValidatePhone(phoneNumber);
    this.validateOtpFormat(otpCode);

    const latestOtp = await this.logs.findLatestPendingOtp(normalizedPhone, 'LOGIN');
    if (!latestOtp) {
      return { success: false, message: 'No active OTP found. Please request a new OTP.' };
    }

    if (latestOtp.expiresAt.getTime() < Date.now()) {
      await this.logs.markFailed(latestOtp.id, 'OTP expired');
      return { success: false, message: 'OTP expired. Please request a new OTP.' };
    }

    const incomingHash = this.hashOtp(otpCode);
    if (incomingHash !== latestOtp.otpCodeHash) {
      const attempts = latestOtp.attempts + 1;
      await this.logs.incrementAttempts(latestOtp.id, 'Invalid OTP');

      if (attempts >= latestOtp.maxAttempts) {
        await this.logs.markFailed(latestOtp.id, 'Maximum verification attempts exceeded');
      }

      return { success: false, message: 'Invalid OTP' };
    }

    await this.logs.markVerified(latestOtp.id);
    return { success: true, message: 'Login success' };
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
    if (!new RegExp(`^\\d{${OtpService.OTP_LENGTH}}$`).test(otpCode)) {
      throw new Error('OTP must be a 6 digit number');
    }
  }

  private generateOtp(): string {
    const upper = 10 ** OtpService.OTP_LENGTH;
    const value = randomInt(0, upper);
    return value.toString().padStart(OtpService.OTP_LENGTH, '0');
  }

  private hashOtp(otpCode: string): string {
    const pepper = process.env['OTP_HASH_PEPPER'] ?? '';
    return createHash('sha256').update(`${otpCode}:${pepper}`).digest('hex');
  }
}
