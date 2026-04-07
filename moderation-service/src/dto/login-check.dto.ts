import { IsIP, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

export class LoginCheckDto {
  @IsNotEmpty()
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsIP()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsNumber()
  failedAttempts?: number;
}
