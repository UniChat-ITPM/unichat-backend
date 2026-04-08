import { IsString, IsEnum, IsNotEmpty } from 'class-validator';
import { PushPlatform } from '@prisma/client';

export class RegisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  deviceToken!: string;

  @IsEnum(PushPlatform)
  platform!: PushPlatform;
}
