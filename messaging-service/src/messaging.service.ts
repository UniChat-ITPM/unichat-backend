import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { MessageRepository } from './repositories/message.repository';
import { ConversationClientService } from './integrations/conversation-client.service';
import { RealtimePublisherService } from './integrations/realtime-publisher.service';
import { MessageType, MessageStatus } from '@prisma/client';
import {
  SendTextMessageDto,
  SendMediaMessageDto,
} from './dto/message.dto';

@Injectable()
export class MessagingService {
  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly conversationClient: ConversationClientService,
    private readonly realtimePublisher: RealtimePublisherService,
  ) {}

  // ─── Verification ──────────────────────────────────────────────────

  private async verifyMembershipOrThrow(conversationId: string, userId: string): Promise<void> {
    const isMember = await this.conversationClient.validateUserMembership(conversationId, userId);
    if (!isMember) {
      throw new ForbiddenException('User is not an active participant in this conversation');
    }
  }

  private async fetchOwnMessageOrThrow(messageId: string, userId: string) {
    const message = await this.messageRepository.findMessageById(messageId);
    if (!message || message.isDeleted) {
      throw new NotFoundException('Message not found');
    }
    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only perform this action on your own messages');
    }
    return message;
  }

  // ─── Sending Messages ──────────────────────────────────────────────

  async sendTextMessage(userId: string, dto: SendTextMessageDto) {
    await this.verifyMembershipOrThrow(dto.conversationId, userId);

    const message = await this.messageRepository.createMessage({
      conversationId: dto.conversationId,
      senderId: userId,
      type: MessageType.TEXT,
      rawText: dto.text,
      replyToMessageId: dto.replyToMessageId,
    });

    this.realtimePublisher.publishMessageCreated(message);
    return message;
  }

  async sendMediaMessage(userId: string, dto: SendMediaMessageDto) {
    await this.verifyMembershipOrThrow(dto.conversationId, userId);

    if (!dto.mediaAssetIds || dto.mediaAssetIds.length === 0) {
      throw new BadRequestException('At least one mediaAssetId must be provided');
    }

    const message = await this.messageRepository.createMessage({
      conversationId: dto.conversationId,
      senderId: userId,
      type: MessageType.IMAGE, // Defaulting to IMAGE; real app might introspect the mediaAsset
      rawText: dto.caption, // Using text field for caption
      replyToMessageId: dto.replyToMessageId,
    });

    // Attach all assets
    for (let i = 0; i < dto.mediaAssetIds.length; i++) {
       await this.messageRepository.attachMedia(message.id, dto.mediaAssetIds[i], i);
    }

    const fullMessage = await this.messageRepository.findMessageById(message.id);
    this.realtimePublisher.publishMessageCreated(fullMessage);
    return fullMessage;
  }

  async forwardMessage(userId: string, messageId: string, targetConversationId: string) {
    await this.verifyMembershipOrThrow(targetConversationId, userId);

    const original = await this.messageRepository.findMessageById(messageId);
    if (!original || original.isDeleted) {
      throw new NotFoundException('Original message not found');
    }

    const forwardedMessage = await this.messageRepository.createMessage({
      conversationId: targetConversationId,
      senderId: userId,
      type: original.type,
      rawText: original.rawText,
    });

    // We can also copy attachments
    for (const attachment of original.attachments) {
      await this.messageRepository.attachMedia(
        forwardedMessage.id,
        attachment.mediaAssetId,
        attachment.sortOrder
      );
    }

    const fullMessage = await this.messageRepository.findMessageById(forwardedMessage.id);
    this.realtimePublisher.publishMessageCreated(fullMessage);
    return fullMessage;
  }

  // ─── Reading / Fetching ────────────────────────────────────────────

  async getConversationMessages(userId: string, conversationId: string, limit: number, cursor?: string) {
    await this.verifyMembershipOrThrow(conversationId, userId);
    return this.messageRepository.findConversationMessages(conversationId, limit, cursor);
  }

  async getMessageById(userId: string, messageId: string) {
    const message = await this.messageRepository.findMessageById(messageId);
    if (!message || message.isDeleted) {
      throw new NotFoundException('Message not found');
    }
    // ensure user is participant
    await this.verifyMembershipOrThrow(message.conversationId, userId);
    return message;
  }

  async getUnreadCount(userId: string, conversationId: string) {
     await this.verifyMembershipOrThrow(conversationId, userId);
     const count = await this.messageRepository.getUnreadCount(conversationId, userId);
     return { conversationId, unreadCount: count };
  }

  // ─── Status Updates ────────────────────────────────────────────────

  async markAsDelivered(userId: string, messageId: string) {
    const msg = await this.getMessageById(userId, messageId);
    await this.messageRepository.markAsDelivered(messageId, userId);

    // If it's the sender marking their own message, maybe we do nothing
    // If it's recipient marking it:
    if (msg.senderId !== userId && msg.status === MessageStatus.SENT) {
      await this.messageRepository.updateMessageStatus(messageId, MessageStatus.DELIVERED);
      this.realtimePublisher.publishMessageStatusUpdated({
        conversationId: msg.conversationId,
        messageId,
        status: MessageStatus.DELIVERED,
      });
    }

    return { success: true };
  }

  async markAsRead(userId: string, messageId: string) {
    const msg = await this.getMessageById(userId, messageId);
    await this.messageRepository.markAsRead(messageId, userId);

    if (msg.senderId !== userId && (msg.status === MessageStatus.SENT || msg.status === MessageStatus.DELIVERED)) {
      await this.messageRepository.updateMessageStatus(messageId, MessageStatus.READ);
      this.realtimePublisher.publishMessageStatusUpdated({
        conversationId: msg.conversationId,
        messageId,
        status: MessageStatus.READ,
      });
    }

    return { success: true };
  }

  // ─── Edit / Delete ─────────────────────────────────────────────────

  async editMessage(userId: string, messageId: string, newText: string) {
    const message = await this.fetchOwnMessageOrThrow(messageId, userId);
    
    // We only allow editing text messages or captions
    const updated = await this.messageRepository.editMessage(
      messageId,
      userId,
      message.rawText,
      newText
    );

    this.realtimePublisher.publishMessageEdited({
      conversationId: message.conversationId,
      messageId: updated.id,
      newText,
    });
    return updated;
  }

  async deleteMessage(userId: string, messageId: string) {
    const message = await this.fetchOwnMessageOrThrow(messageId, userId);

    await this.messageRepository.softDeleteMessage(messageId);
    this.realtimePublisher.publishMessageDeleted({
      conversationId: message.conversationId,
      messageId,
    });

    return { success: true, message: 'Message deleted' };
  }
}
