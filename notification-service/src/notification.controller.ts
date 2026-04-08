import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  // ─── Helper ────────────────────────────────────────────────────────

  private getUserId(xUserId: string): string {
    if (!xUserId) {
      throw new UnauthorizedException('Missing x-user-id header');
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(xUserId)) {
      throw new BadRequestException('Invalid user ID format');
    }
    return xUserId;
  }

  // ─── Internal / Creation ───────────────────────────────────────────

  @Post()
  async createNotificationInternal(
    @Body() dto: CreateNotificationDto,
  ) {
    // Note: Usually triggered internally by other microservices.
    // Ensure that it's authenticated or comes via API Gateway.
    return this.notificationService.createNotification(dto);
  }

  // ─── User Reads / State ────────────────────────────────────────────

  @Get()
  async getNotifications(
    @Headers('x-user-id') xUserId: string,
    @Query() query: NotificationQueryDto,
  ) {
    return this.notificationService.getNotifications(
      this.getUserId(xUserId),
      query.limit,
      query.cursor,
      query.isRead,
      query.type,
    );
  }

  @Get('unread-count')
  async getUnreadCount(
    @Headers('x-user-id') xUserId: string,
  ) {
    return this.notificationService.getUnreadCount(this.getUserId(xUserId));
  }

  @Get('preferences')
  async getPreferences(
    @Headers('x-user-id') xUserId: string,
  ) {
    return this.notificationService.getPreferences(this.getUserId(xUserId));
  }

  @Patch('preferences')
  async updatePreferences(
    @Headers('x-user-id') xUserId: string,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.notificationService.updatePreferences(this.getUserId(xUserId), dto);
  }

  @Get('devices')
  async getDevices(
    @Headers('x-user-id') xUserId: string,
  ) {
    return this.notificationService.getUserDevices(this.getUserId(xUserId));
  }

  @Post('devices')
  async registerDevice(
    @Headers('x-user-id') xUserId: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.notificationService.registerDevice(this.getUserId(xUserId), dto.deviceToken, dto.platform);
  }

  @Delete('devices/:deviceToken')
  async removeDevice(
    @Headers('x-user-id') xUserId: string,
    @Param('deviceToken') deviceToken: string,
  ) {
    return this.notificationService.removeDevice(this.getUserId(xUserId), deviceToken);
  }

  @Post('push/test')
  async sendTestPush(
    @Headers('x-user-id') xUserId: string,
    @Body('title') title: string,
    @Body('body') body: string,
  ) {
    if (!title || !body) throw new BadRequestException('Title and body required');
    await this.notificationService.sendPushNotification(this.getUserId(xUserId), title, body);
    return { success: true };
  }

  @Patch('read-all')
  async markAllAsRead(
    @Headers('x-user-id') xUserId: string,
  ) {
    return this.notificationService.markAllAsRead(this.getUserId(xUserId));
  }

  @Get(':id')
  async getNotificationById(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
  ) {
    return this.notificationService.getNotificationById(id, this.getUserId(xUserId));
  }

  @Patch(':id/read')
  async markAsRead(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
  ) {
    return this.notificationService.markAsRead(id, this.getUserId(xUserId));
  }

  @Patch(':id/unread')
  async markAsUnread(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
  ) {
    return this.notificationService.markAsUnread(id, this.getUserId(xUserId));
  }

  @Delete(':id')
  async deleteNotification(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
  ) {
    return this.notificationService.deleteNotification(id, this.getUserId(xUserId));
  }
}
