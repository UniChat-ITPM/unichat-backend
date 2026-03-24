import { Module } from '@nestjs/common';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';
import { NotificationLogRepository } from './repositories/notification-log.repository';
import { WhatsappProviderService } from './providers/whatsapp-provider.service';

@Module({
  controllers: [OtpController],
  providers: [
    OtpService,
    NotificationLogRepository,
    WhatsappProviderService,
  ],
  exports: [OtpService],
})
export class OtpModule {}
