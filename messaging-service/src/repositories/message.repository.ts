import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  MessageStatus,
  MessageType,
  Prisma,
} from '@prisma/client';

@Injectable()
export class MessageRepository implements OnModuleDestroy {
  private readonly logger = new Logger(MessageRepository.name);
  private readonly prisma: PrismaClient;

  constructor() {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required to initialize Prisma');
    }

    const adapter = new PrismaPg({ connectionString: databaseUrl });
    this.prisma = new PrismaClient({ adapter });
  }

  // ─── Message CRUD ──────────────────────────────────────────────

  async createMessage(data: {
    conversationId: string;
    senderId: string;
    type: MessageType;
    rawText?: string;
    normalizedText?: string;
    replyToMessageId?: string;
  }) {
    return this.prisma.message.create({
      data: {
        conversationId: data.conversationId,
        senderId: data.senderId,
        type: data.type,
        rawText: data.rawText,
        normalizedText: data.normalizedText,
        replyToMessageId: data.replyToMessageId,
        status: MessageStatus.SENT,
      },
    });
  }

  async attachMedia(messageId: string, mediaAssetId: string, sortOrder: number = 0) {
    return this.prisma.messageAttachment.create({
      data: {
        messageId,
        mediaAssetId,
        sortOrder,
      },
    });
  }

  async findMessageById(id: string) {
    return this.prisma.message.findUnique({
      where: { id },
      include: {
        attachments: {
          include: { mediaAsset: true },
        },
      },
    });
  }

  async findConversationMessages(
    conversationId: string,
    limit: number = 50,
    cursor?: string,
  ) {
    const args: Prisma.MessageFindManyArgs = {
      where: {
        conversationId,
        isDeleted: false,
      },
      take: limit + 1, // take an extra item to determine if there's a next page
      orderBy: { sentAt: 'desc' },
      include: {
        attachments: {
          include: { mediaAsset: true },
        },
      },
    };

    if (cursor) {
      args.cursor = { id: cursor };
      // skip the cursor element itself
      args.skip = 1;
    }

    const messages = await this.prisma.message.findMany(args);

    let nextCursor: typeof cursor | undefined = undefined;
    if (messages.length > limit) {
      const nextItem = messages.pop();
      nextCursor = nextItem?.id;
    }

    return {
      items: messages,
      nextCursor,
    };
  }

  async updateMessageStatus(id: string, status: MessageStatus) {
    return this.prisma.message.update({
      where: { id },
      data: { status },
    });
  }

  async editMessage(
    id: string,
    editorId: string,
    oldRawText: string | null,
    newRawText: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Create history record
      await tx.messageEditHistory.create({
        data: {
          messageId: id,
          editedByUserId: editorId,
          previousRawText: oldRawText,
          newRawText: newRawText,
        },
      });

      // Update message
      return tx.message.update({
        where: { id },
        data: {
          rawText: newRawText,
          isEdited: true,
          editedAt: new Date(),
        },
      });
    });
  }

  async softDeleteMessage(id: string) {
    return this.prisma.message.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        // Optional: blank out the text if required by privacy
        // rawText: null,
      },
    });
  }

  // ─── Message Receipts ──────────────────────────────────────────

  async markAsRead(messageId: string, userId: string) {
    return this.prisma.messageReceipt.upsert({
      where: {
        messageId_userId_status: {
          messageId,
          userId,
          status: 'READ',
        },
      },
      create: {
        messageId,
        userId,
        status: 'READ',
        statusAt: new Date(),
      },
      update: {
        statusAt: new Date(), // touch timestamp if already read
      },
    });
  }

  async markAsDelivered(messageId: string, userId: string) {
    return this.prisma.messageReceipt.upsert({
      where: {
        messageId_userId_status: {
          messageId,
          userId,
          status: 'DELIVERED',
        },
      },
      create: {
        messageId,
        userId,
        status: 'DELIVERED',
        statusAt: new Date(),
      },
      update: {
        statusAt: new Date(),
      },
    });
  }

  // Count unread
  // Assuming a user has unread messages if there's no READ receipt for a message in a conversation they are part of.
  // Alternatively, the ConversationParticipant model tracks `lastReadMessageId` and `unreadCount`.
  // We'll trust that there's a specialized process for this, or provide a simple method.
  async getUnreadCount(conversationId: string, userId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      select: { unreadCount: true },
    });
    return participant?.unreadCount || 0;
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
