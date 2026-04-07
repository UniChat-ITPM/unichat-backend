import { Module } from '@nestjs/common';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { ConversationRepository } from './repositories/conversation.repository';
import { CloudinaryService } from './cloudinary.service';

@Module({
  controllers: [ConversationController],
  providers: [ConversationService, ConversationRepository, CloudinaryService],
  exports: [ConversationService],
})
export class ConversationModule { }
