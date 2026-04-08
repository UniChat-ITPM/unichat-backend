import { IsString, IsEnum, IsOptional, IsObject, IsNotEmpty } from 'class-validator';
import { NotificationType, NotificationPriority } from '@prisma/client';

export class CreateNotificationDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsEnum(NotificationType)
  type!: NotificationType;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  body!: string;

  @IsOptional()
  @IsObject()
  data?: any;

  @IsOptional()
  @IsEnum(NotificationPriority)
  priority?: NotificationPriority;
}
