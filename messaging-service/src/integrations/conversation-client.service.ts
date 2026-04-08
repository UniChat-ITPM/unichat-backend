import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  ParticipantStatus,
  ConversationStatus,
  ConversationType,
} from '@prisma/client';

const MEMBERSHIP_CACHE_MS = 90_000;
const MEMBERSHIP_CACHE_MAX = 2_000;

/**
 * A dedicated repository/client for Conversation Service integration.
 * It directly checks the DB to validate if a user is an active participant in an active conversation.
 */
@Injectable()
export class ConversationClientService {
  private readonly prisma: PrismaClient;
  private readonly membershipCache = new Map<
    string,
    { exp: number; ok: boolean }
  >();

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
    const cacheKey = `${conversationId}:${userId}`;
    const now = Date.now();
    const hit = this.membershipCache.get(cacheKey);
    if (hit && hit.exp > now) {
      return hit.ok;
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          where: { userId },
        },
      },
    });

    let ok = false;
    if (conversation?.status === ConversationStatus.ACTIVE) {
      const participant = conversation.participants[0];
      ok = Boolean(participant && participant.status === ParticipantStatus.ACTIVE);
    }

    if (this.membershipCache.size >= MEMBERSHIP_CACHE_MAX) {
      const dropBefore = now - MEMBERSHIP_CACHE_MS;
      for (const [k, v] of this.membershipCache) {
        if (v.exp < dropBefore) {
          this.membershipCache.delete(k);
        }
      }
      if (this.membershipCache.size >= MEMBERSHIP_CACHE_MAX) {
        const half = Math.floor(MEMBERSHIP_CACHE_MAX / 2);
        let i = 0;
        for (const k of this.membershipCache.keys()) {
          this.membershipCache.delete(k);
          if (++i >= half) {
            break;
          }
        }
      }
    }
    this.membershipCache.set(cacheKey, {
      exp: now + MEMBERSHIP_CACHE_MS,
      ok,
    });
    return ok;
  }

  /**
   * For DIRECT (1:1) threads: if either participant has blocked the other — in either direction —
   * neither user may send new messages until the block is removed.
   */
  async assertDirectConversationNotBlocked(
    senderUserId: string,
    conversationId: string,
  ): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        type: true,
        participants: {
          where: { status: ParticipantStatus.ACTIVE },
          select: { userId: true },
        },
      },
    });

    if (!conv || conv.type !== ConversationType.DIRECT) {
      return;
    }

    const userIds = conv.participants.map((p) => p.userId);
    if (userIds.length !== 2) {
      return;
    }

    const peerUserId = userIds.find((id) => id !== senderUserId);
    if (!peerUserId) {
      return;
    }

    const block = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerUserId: senderUserId, blockedUserId: peerUserId },
          { blockerUserId: peerUserId, blockedUserId: senderUserId },
        ],
      },
    });

    if (block) {
      throw new ForbiddenException(
        'Messaging is not available between you and this user while one of you is blocked.',
      );
    }
  }

  /** Bump row so home "Chats" list sorts this thread to the top after new activity. */
  async touchConversationActivity(conversationId: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
  }
}
