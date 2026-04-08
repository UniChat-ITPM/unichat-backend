import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  NotificationType,
  NotificationPriority,
  PushPlatform,
} from '@prisma/client';

@Injectable()
export class NotificationRepository implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationRepository.name);
  private readonly prisma: PrismaClient;

  constructor() {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required to initialize Prisma');
    }

    const adapter = new PrismaPg({ connectionString: databaseUrl });
    this.prisma = new PrismaClient({ adapter });
  }

  // ─── Notification CRUD ─────────────────────────────────────────

  async createNotification(data: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: any;
    priority?: NotificationPriority;
  }) {
    return this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        body: data.body,
        data: data.data,
        priority: data.priority || NotificationPriority.NORMAL,
      },
    });
  }

  async getNotifications(userId: string, limit = 50, cursor?: string, isRead?: boolean, type?: NotificationType) {
    const lim = Math.max(1, Math.floor(Number(limit)) || 50);
    const where: any = { userId };
    if (isRead !== undefined) {
      where.isRead = isRead;
    }
    if (type !== undefined) {
      where.type = type;
    }

    const args: any = {
      where,
      take: lim + 1,
      orderBy: { createdAt: 'desc' },
    };

    if (cursor) {
      args.cursor = { id: cursor };
      args.skip = 1;
    }

    const notifications = await this.prisma.notification.findMany(args);

    let nextCursor: typeof cursor | undefined = undefined;
    if (notifications.length > lim) {
      const nextItem = notifications.pop();
      nextCursor = nextItem?.id;
    }

    return {
      items: notifications,
      nextCursor,
    };
  }

  async getNotificationById(id: string, userId: string) {
    return this.prisma.notification.findFirst({
      where: { id, userId },
    });
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async updateReadStatus(id: string, userId: string, isRead: boolean) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead, readAt: isRead ? new Date() : null },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async deleteNotification(id: string, userId: string) {
    return this.prisma.notification.deleteMany({
      where: { id, userId },
    });
  }

  // ─── Preferences ──────────────────────────────────────────────

  async getPreferences(userId: string) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async updatePreferences(userId: string, data: {
    messageNotifications?: boolean;
    groupNotifications?: boolean;
    otpNotifications?: boolean;
    securityNotifications?: boolean;
    pushNotifications?: boolean;
  }) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        ...data,
      },
      update: data,
    });
  }

  // ─── Devices ──────────────────────────────────────────────────

  async registerDevice(userId: string, deviceToken: string, platform: PushPlatform) {
    return this.prisma.notificationDevice.upsert({
      where: { deviceToken },
      create: {
        userId,
        deviceToken,
        platform,
        isActive: true,
      },
      update: {
        userId, // update if reassigned
        platform,
        isActive: true,
        updatedAt: new Date(),
      },
    });
  }

  async removeDevice(userId: string, deviceToken: string) {
    return this.prisma.notificationDevice.deleteMany({
      where: { userId, deviceToken },
    });
  }

  async getUserDevices(userId: string) {
    return this.prisma.notificationDevice.findMany({
      where: { userId, isActive: true },
    });
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
