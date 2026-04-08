import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationRepository } from './repositories/notification.repository';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { PushPlatform } from '@prisma/client';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly notificationRepo: NotificationRepository) {}

  // ─── Core App Logic ──────────────────────────────────────────

  async createNotification(dto: CreateNotificationDto) {
    // 1. Check preferences before potentially sending a push/creating an internal alert
    const prefs = await this.notificationRepo.getPreferences(dto.userId);

    let shouldCreate = true;
    switch (dto.type) {
      case 'MESSAGE':
        shouldCreate = prefs.messageNotifications;
        break;
      case 'GROUP':
        shouldCreate = prefs.groupNotifications;
        break;
      case 'OTP':
        shouldCreate = prefs.otpNotifications;
        break;
      case 'SECURITY':
        shouldCreate = prefs.securityNotifications;
        break;
      // SYSTEM types or others typically bypass preference toggles or default to true
    }

    if (!shouldCreate) {
      this.logger.log(`Skipped creating notification for user ${dto.userId} due to preferences`);
      return null;
    }

    // 2. Create the notification record
    const notification = await this.notificationRepo.createNotification(dto);

    // 3. (Optional / Future) Deliver push notification if Push is enabled
    if (prefs.pushNotifications) {
      this.sendPushNotification(dto.userId, dto.title, dto.body, dto.data).catch((err) => {
        this.logger.error(`Failed to send push: ${err.message}`);
      });
    }

    return notification;
  }

  async getNotifications(userId: string, limit?: number, cursor?: string, isRead?: boolean, type?: any) {
    return this.notificationRepo.getNotifications(userId, limit, cursor, isRead, type);
  }

  async getNotificationById(id: string, userId: string) {
    const notification = await this.notificationRepo.getNotificationById(id, userId);
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    return notification;
  }

  async getUnreadCount(userId: string) {
    return { unreadCount: await this.notificationRepo.getUnreadCount(userId) };
  }

  async markAsRead(id: string, userId: string) {
    await this.getNotificationById(id, userId); // verify exists
    await this.notificationRepo.updateReadStatus(id, userId, true);
    return { success: true };
  }

  async markAllAsRead(userId: string) {
    const result = await this.notificationRepo.markAllAsRead(userId);
    return { success: true, count: result.count };
  }

  async markAsUnread(id: string, userId: string) {
    await this.getNotificationById(id, userId); // verify exists
    await this.notificationRepo.updateReadStatus(id, userId, false);
    return { success: true };
  }

  async deleteNotification(id: string, userId: string) {
    await this.getNotificationById(id, userId); // verify exists
    await this.notificationRepo.deleteNotification(id, userId);
    return { success: true };
  }

  // ─── Preferences ──────────────────────────────────────────────

  async getPreferences(userId: string) {
    return this.notificationRepo.getPreferences(userId);
  }

  async updatePreferences(userId: string, dto: any) {
    return this.notificationRepo.updatePreferences(userId, dto);
  }

  // ─── Devices & Push ──────────────────────────────────────────

  async registerDevice(userId: string, deviceToken: string, platform: PushPlatform) {
    return this.notificationRepo.registerDevice(userId, deviceToken, platform);
  }

  async removeDevice(userId: string, deviceToken: string) {
    await this.notificationRepo.removeDevice(userId, deviceToken);
    return { success: true };
  }

  async getUserDevices(userId: string) {
    return this.notificationRepo.getUserDevices(userId);
  }

  async sendPushNotification(userId: string, title: string, body: string, data?: any) {
    // Placeholder for FCM integration
    const devices = await this.getUserDevices(userId);
    if (!devices.length) return;

    this.logger.log(`[PUSH MOCK] Sending push to User ${userId} (${devices.length} devices)`);
    this.logger.log(`[PUSH MOCK] Title: ${title} | Body: ${body}`);
  }
}
