import { Injectable, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { NotificationLogRepository } from './repositories/notification-log.repository';
import { WhatsappProviderService } from './providers/whatsapp-provider.service';

@Injectable()
export class OtpService implements OnModuleInit {
  private readonly authServiceBaseUrl =
    process.env['AUTH_SERVICE_URL'] ?? 'http://localhost:4226/api';

  constructor(
    private readonly logs: NotificationLogRepository,
    private readonly whatsappProvider: WhatsappProviderService,
  ) {}

  async onModuleInit() {
    await this.whatsappProvider.initialize();
  }

  async requestOtp(phoneNumber: string) {
    const normalizedPhone = this.normalizeAndValidatePhone(phoneNumber);

    // 1) Ensure number exists on WhatsApp before requesting an OTP.
    const isWhatsappUser = await this.whatsappProvider.isWhatsappUser(
      normalizedPhone,
    );
    if (!isWhatsappUser) {
      return {
        success: false,
        message: 'Provided mobile number is not available on WhatsApp',
      };
    }

    // 2) Ask auth-service to generate and store OTP hash in DB.
    const generateResp = await axios.post(
      `${this.authServiceBaseUrl}/auth/otp/generate`,
      { phoneNumber: normalizedPhone, purpose: 'LOGIN' },
    );

    if (!generateResp.data?.success) {
      return {
        success: false,
        message: generateResp.data?.message ?? 'Failed to generate OTP',
      };
    }

    const { otpCode, requestId, expiresAt } = generateResp.data as {
      otpCode: string;
      requestId: string;
      expiresAt: Date;
    };

    const messageBody = `Your UniChat OTP is ${otpCode}. It will expire in 5 minutes.`;

    // 3) Delivery to user (retry WhatsApp send failures).
    const maxSendRetries = Number(process.env['OTP_SEND_RETRIES'] ?? 3);
    let lastError: string | undefined;
    for (let attempt = 1; attempt <= maxSendRetries; attempt += 1) {
      try {
        const providerMessageId = await this.whatsappProvider.sendMessage(
          normalizedPhone,
          messageBody,
        );
        await this.logs.markSent(requestId, providerMessageId);
        lastError = undefined;
        break;
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : 'Failed to send OTP on WhatsApp';
        if (attempt < maxSendRetries) {
          await new Promise((r) => setTimeout(r, 800 * attempt));
        }
      }
    }

    if (lastError) {
      await this.logs.markFailed(requestId, lastError);
      return {
        success: false,
        message: 'OTP generated but WhatsApp delivery failed',
      };
    }

    return {
      success: true,
      message: 'OTP sent successfully',
      otpCode,
      requestId,
      expiresAt,
    };
  }

  async verifyOtp(phoneNumber: string, otpCode: string) {
    // Verification authority is auth-service.
    const resp = await axios.post(
      `${this.authServiceBaseUrl}/auth/otp/verify`,
      { phoneNumber, otpCode },
    );
    return resp.data;
  }

  private normalizeAndValidatePhone(phoneNumber: string): string {
    const normalized = phoneNumber.trim().replace(/\s+/g, '');
    const e164Pattern = /^\+[1-9]\d{7,14}$/;
    if (!e164Pattern.test(normalized)) {
      throw new Error('Phone number must be in E.164 format, e.g. +94771234567');
    }
    return normalized;
  }
}
