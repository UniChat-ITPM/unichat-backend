import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { OtpChannel, OtpPurpose, OtpRequest, OtpStatus, PrismaClient } from '@prisma/client';
import { NotificationChannel } from '../types/notification.types';

type CreateNotificationLogInput = {
  phoneNumber: string;
  channel: NotificationChannel;
  status: OtpStatus;
  purpose: string;
  messageBody: string;
  maxRetries: number;
  userId?: string;
  templateName?: string;
  variables?: Record<string, string | number>;
};

type CreateOtpRequestInput = {
  phoneNumber: string;
  otpHash: string;
  expiresAt: Date;
  maxAttempts: number;
  channel: NotificationChannel;
  purpose: string;
};

@Injectable()
export class NotificationLogRepository implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationLogRepository.name);
  private readonly prisma: PrismaClient;

  constructor() {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required to initialize Prisma');
    }

    const adapter = new PrismaPg({ connectionString: databaseUrl });
    this.prisma = new PrismaClient({ adapter });
  }

  async create(input: CreateNotificationLogInput): Promise<OtpRequest> {
    return this.prisma.otpRequest.create({
      data: {
        userId: input.userId,
        phoneNumber: input.phoneNumber,
        otpCodeHash: `template:${input.templateName ?? 'GENERIC'}`,
        channel: this.toOtpChannel(input.channel),
        purpose: this.toOtpPurpose(input.purpose),
        status: input.status,
        attempts: 0,
        maxAttempts: input.maxRetries,
        expiresAt: new Date(Date.now() + 5 * 60_000),
        failureReason: JSON.stringify({
          templateName: input.templateName,
          messageBody: input.messageBody,
          variables: input.variables ?? {},
        }),
      },
    });
  }

  async createOtpRequest(input: CreateOtpRequestInput): Promise<OtpRequest> {
    return this.prisma.otpRequest.create({
      data: {
        phoneNumber: input.phoneNumber,
        otpCodeHash: input.otpHash,
        channel: this.toOtpChannel(input.channel),
        purpose: this.toOtpPurpose(input.purpose),
        status: OtpStatus.PENDING,
        attempts: 0,
        maxAttempts: input.maxAttempts,
        expiresAt: input.expiresAt,
      },
    });
  }

  async markSent(id: string, providerMessageId?: string): Promise<void> {
    await this.prisma.otpRequest.update({
      where: { id },
      data: {
        status: OtpStatus.SENT,
        sentAt: new Date(),
        providerMessageId,
        failureReason: null,
      },
    });
  }

  async markRetrying(id: string): Promise<void> {
    await this.prisma.otpRequest.update({
      where: { id },
      data: { status: OtpStatus.PENDING },
    });
  }

  async incrementAttempts(id: string, reason: string): Promise<void> {
    const current = await this.findById(id);
    const attempts = (current?.attempts ?? 0) + 1;
    await this.prisma.otpRequest.update({
      where: { id },
      data: {
        attempts,
        failureReason: reason,
      },
    });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.prisma.otpRequest.update({
      where: { id },
      data: {
        status: OtpStatus.FAILED,
        failureReason: reason,
      },
    });
  }

  async markVerified(id: string): Promise<void> {
    await this.prisma.otpRequest.update({
      where: { id },
      data: {
        status: OtpStatus.VERIFIED,
        verifiedAt: new Date(),
        failureReason: null,
      },
    });
  }

  async findById(id: string): Promise<OtpRequest | null> {
    return this.prisma.otpRequest.findUnique({ where: { id } });
  }

  async findMany(input: { phoneNumber?: string; limit?: number }) {
    return this.prisma.otpRequest.findMany({
      where: input.phoneNumber ? { phoneNumber: input.phoneNumber } : undefined,
      orderBy: { createdAt: 'desc' },
      take: input.limit ?? 50,
    });
  }

  async findLatestPendingOtp(
    phoneNumber: string,
    purpose: string,
  ): Promise<OtpRequest | null> {
    return this.prisma.otpRequest.findFirst({
      where: {
        phoneNumber,
        purpose: this.toOtpPurpose(purpose),
        status: {
          in: [OtpStatus.PENDING, OtpStatus.SENT],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  private toOtpChannel(channel: NotificationChannel): OtpChannel {
    switch (channel) {
      case NotificationChannel.WHATSAPP:
        return OtpChannel.WHATSAPP;
      case NotificationChannel.SMS:
        return OtpChannel.SMS;
      default:
        return OtpChannel.EMAIL;
    }
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
    this.logger.warn(`Unsupported purpose "${purpose}", falling back to LOGIN`);
    return OtpPurpose.LOGIN;
  }
}
