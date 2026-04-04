import { Module } from '@nestjs/common';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { MessageRepository } from './repositories/message.repository';
import { ConversationClientService } from './integrations/conversation-client.service';
import { RealtimePublisherService } from './integrations/realtime-publisher.service';
import { ChatMediaService } from './chat-media.service';

@Module({
  controllers: [MessagingController],
  providers: [
    MessagingService,
    MessageRepository,
    ConversationClientService,
    RealtimePublisherService,
    ChatMediaService,
  ],
  exports: [MessagingService]
})
export class MessagingModule {}
