import { Injectable, Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, ParticipantStatus, ConversationStatus } from '@prisma/client';

/**
 * A dedicated repository/client for Conversation Service integration.
 * It directly checks the DB to validate if a user is an active participant in an active conversation.
 */
@Injectable()
export class ConversationClientService {
  private readonly logger = new Logger(ConversationClientService.name);
  private readonly prisma: PrismaClient;

  constructor() {
    // Relying on internal DB sharing for microservice communication, similar to repository pattern uses.
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required to initialize Prisma');
    }

    const adapter = new PrismaPg({ connectionString: databaseUrl });
    this.prisma = new PrismaClient({ adapter });
  }

  async validateUserMembership(conversationId: string, userId: string): Promise<boolean> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          where: { userId },
        },
      },
    });

    if (!conversation) {
      return false;
    }

    if (conversation.status !== ConversationStatus.ACTIVE) {
      return false;
    }

    const participant = conversation.participants[0];
    if (!participant) {
      return false;
    }

    return participant.status === ParticipantStatus.ACTIVE;
  }
}
