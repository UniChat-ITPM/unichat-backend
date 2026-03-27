import { Module } from '@nestjs/common';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { MessageRepository } from './repositories/message.repository';
import { ConversationClientService } from './integrations/conversation-client.service';
import { RealtimePublisherService } from './integrations/realtime-publisher.service';

@Module({
  controllers: [MessagingController],
  providers: [
    MessagingService,
    MessageRepository,
    ConversationClientService,
    RealtimePublisherService,
  ],
  exports: [MessagingService]
})
export class MessagingModule {}
