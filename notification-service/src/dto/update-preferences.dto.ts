import { IsOptional, IsBoolean } from 'class-validator';

export class UpdatePreferencesDto {
  @IsOptional()
  @IsBoolean()
  messageNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  groupNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  otpNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  securityNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  pushNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  muteGroupNotifications?: boolean;
}
