import { IsIP, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class OtpCheckDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Phone number must be in E.164 format',
  })
  phoneNumber!: string;

  @IsOptional()
  @IsIP()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}
