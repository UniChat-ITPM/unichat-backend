import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum OtpRecordAction {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
  ABUSE = 'ABUSE',
}

export class OtpRecordDto {
  @IsNotEmpty()
  @IsString()
  phoneNumber!: string;

  @IsNotEmpty()
  @IsEnum(OtpRecordAction)
  action!: OtpRecordAction;

  @IsOptional()
  @IsString()
  reason?: string;
  
  @IsOptional()
  userId?: string;
}
