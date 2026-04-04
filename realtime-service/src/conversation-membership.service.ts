import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  ParticipantStatus,
  ConversationStatus,
} from '@prisma/client';
import Redis from 'ioredis';
import { REDIS_CACHE } from './redis.tokens';

const MEMBER_CACHE_TTL_SEC = 120;

function memberCacheKey(conversationId: string, userId: string): string {
  return `unichat:cache:conv:member:${conversationId}:${userId}`;
}

@Injectable()
export class ConversationMembershipService implements OnModuleDestroy {
  private readonly logger = new Logger(ConversationMembershipService.name);
  private readonly prisma: PrismaClient;

  constructor(@Inject(REDIS_CACHE) private readonly redis: Redis) {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required for realtime membership checks');
    }
    const adapter = new PrismaPg({ connectionString: databaseUrl });
    this.prisma = new PrismaClient({ adapter });
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  async isActiveMember(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const key = memberCacheKey(conversationId, userId);
    try {
      const hit = await this.redis.get(key);
      if (hit === '1') return true;
    } catch (e) {
      this.logger.warn(`Redis membership cache read: ${e}`);
    }

    const ok = await this.loadMembershipFromDb(conversationId, userId);
    if (ok) {
      try {
        await this.redis.set(key, '1', 'EX', MEMBER_CACHE_TTL_SEC);
      } catch (e) {
        this.logger.warn(`Redis membership cache write: ${e}`);
      }
    }
    return ok;
  }

  private async loadMembershipFromDb(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
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
    return (
      !!participant && participant.status === ParticipantStatus.ACTIVE
    );
  }
}
