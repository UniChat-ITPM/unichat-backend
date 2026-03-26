import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import amqplib, { Channel, Connection, ConsumeMessage } from 'amqplib';
import { NotificationLogRepository } from './repositories/notification-log.repository';
import { WhatsappProviderService } from './providers/whatsapp-provider.service';

@Injectable()
export class OtpService implements OnModuleInit, OnModuleDestroy {
  private readonly authServiceBaseUrl =
    process.env['AUTH_SERVICE_URL'] ?? 'http://localhost:4226/api';

  private readonly rabbitMqUrl =
    process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672';

  private readonly otpSendQueue =
    process.env['OTP_SEND_QUEUE'] ?? 'otp.send';

  private readonly maxSendRetries = Number(process.env['OTP_SEND_RETRIES'] ?? 3);

  private rabbitConnection: Connection | null = null;
  private rabbitChannel: Channel | null = null;

  private readonly scheduledRetryTimers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly logs: NotificationLogRepository,
    private readonly whatsappProvider: WhatsappProviderService,
  ) {}

  async onModuleInit() {
    await this.whatsappProvider.initialize();
    await this.initRabbitMq();
    await this.startOtpSendConsumer();
  }

  async onModuleDestroy() {
    for (const timer of this.scheduledRetryTimers) {
      clearTimeout(timer);
    }
    this.scheduledRetryTimers.clear();

    try {
      await this.rabbitChannel?.close();
    } catch {
      // ignore close errors on shutdown
    }
    try {
      await this.rabbitConnection?.close();
    } catch {
      // ignore close errors on shutdown
    }

    // Keep whatsapp shutdown lightweight; the provider currently supports destroy().
    await this.whatsappProvider.shutdown();
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

    // 3) Enqueue OTP delivery to be processed by RabbitMQ consumer.
    //    This makes `/otp/request` fast (no WhatsApp send wait).
    await this.enqueueOtpSendJob({
      requestId,
      phoneNumber: normalizedPhone,
      otpCode,
      messageBody,
      purpose: 'LOGIN',
      retryCount: 0,
    });

    return {
      success: true,
      message: 'OTP queued for WhatsApp delivery',
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

  private async initRabbitMq() {
    this.rabbitConnection = await amqplib.connect(this.rabbitMqUrl);
    this.rabbitChannel = await this.rabbitConnection.createChannel();

    await this.rabbitChannel.assertQueue(this.otpSendQueue, {
      durable: true,
    });

    // Process one job at a time per service instance.
    await this.rabbitChannel.prefetch(1);
  }

  private async startOtpSendConsumer() {
    if (!this.rabbitChannel) return;

    await this.rabbitChannel.consume(
      this.otpSendQueue,
      (msg) => void this.handleOtpSendMessage(msg),
      { noAck: false },
    );
  }

  private async handleOtpSendMessage(msg: ConsumeMessage | null) {
    if (!msg) return;
    if (!this.rabbitChannel) return;

    const retryFromHeader = Number(
      msg.properties?.headers?.['x-retry-count'] ?? 0,
    );

    const payload = JSON.parse(msg.content.toString()) as {
      requestId: string;
      phoneNumber: string;
      otpCode: string;
      messageBody: string;
      purpose: string;
      retryCount?: number;
    };

    const retryCount = Number.isFinite(payload.retryCount)
      ? payload.retryCount
      : retryFromHeader;

    try {
      const providerMessageId = await this.whatsappProvider.sendMessage(
        payload.phoneNumber,
        payload.messageBody,
      );

      await this.logs.markSent(payload.requestId, providerMessageId);
      this.rabbitChannel.ack(msg);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Failed to send OTP on WhatsApp';

      const nextRetry = retryCount + 1;

      if (retryCount < this.maxSendRetries) {
        const backoffMs = Math.min(60_000, 800 * 2 ** retryCount);

        const timer = setTimeout(() => {
          void this.rabbitChannel
            ?.sendToQueue(
              this.otpSendQueue,
              Buffer.from(
                JSON.stringify({
                  ...payload,
                  retryCount: nextRetry,
                }),
              ),
              {
                persistent: true,
                headers: { 'x-retry-count': nextRetry },
              },
            )
            .catch(() => {
              // swallow republish errors; a new request will eventually create another job
            })
            .finally(() => {
              this.scheduledRetryTimers.delete(timer);
            });
        }, backoffMs);

        this.scheduledRetryTimers.add(timer);
        this.rabbitChannel.ack(msg);
      } else {
        await this.logs.markFailed(payload.requestId, reason);
        this.rabbitChannel.ack(msg);
      }
    }
  }

  private async enqueueOtpSendJob(payload: {
    requestId: string;
    phoneNumber: string;
    otpCode: string;
    messageBody: string;
    purpose: string;
    retryCount: number;
  }) {
    if (!this.rabbitChannel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    await this.rabbitChannel.sendToQueue(
      this.otpSendQueue,
      Buffer.from(JSON.stringify(payload)),
      {
        persistent: true,
        headers: { 'x-retry-count': payload.retryCount },
      },
    );
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
