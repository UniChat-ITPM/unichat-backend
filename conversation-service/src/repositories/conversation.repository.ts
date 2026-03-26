import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  ConversationType,
  ConversationStatus,
  ParticipantRole,
  ParticipantStatus,
  GroupJoinApprovalMode,
  GroupMemberAddMode,
} from '@prisma/client';

@Injectable()
export class ConversationRepository implements OnModuleDestroy {
  private readonly logger = new Logger(ConversationRepository.name);
  private readonly prisma: PrismaClient;

  constructor() {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required to initialize Prisma');
    }

    const adapter = new PrismaPg({ connectionString: databaseUrl });
    this.prisma = new PrismaClient({ adapter });
  }

  // ─── Conversation CRUD ──────────────────────────────────────────────

  async createConversation(data: {
    type: ConversationType;
    title?: string;
    description?: string;
    imageUrl?: string;
    createdByUserId: string;
  }) {
    return this.prisma.conversation.create({
      data: {
        type: data.type,
        status: ConversationStatus.ACTIVE,
        title: data.title,
        description: data.description,
        imageUrl: data.imageUrl,
        createdByUserId: data.createdByUserId,
      },
    });
  }

  async findConversationById(id: string) {
    return this.prisma.conversation.findUnique({
      where: { id },
      include: {
        participants: {
          where: { status: ParticipantStatus.ACTIVE },
          select: {
            id: true,
            userId: true,
            role: true,
            status: true,
            joinedAt: true,
            mutedUntil: true,
            archivedAt: true,
          },
        },
        groupDetail: true,
      },
    });
  }

  async updateConversation(
    id: string,
    data: {
      title?: string;
      description?: string;
      imageUrl?: string;
      status?: ConversationStatus;
    },
  ) {
    return this.prisma.conversation.update({
      where: { id },
      data,
    });
  }

  // ─── Participant CRUD ───────────────────────────────────────────────

  async createParticipant(data: {
    conversationId: string;
    userId: string;
    role: ParticipantRole;
  }) {
    return this.prisma.conversationParticipant.create({
      data: {
        conversationId: data.conversationId,
        userId: data.userId,
        role: data.role,
        status: ParticipantStatus.ACTIVE,
      },
    });
  }

  async createManyParticipants(
    participants: {
      conversationId: string;
      userId: string;
      role: ParticipantRole;
    }[],
  ) {
    return this.prisma.conversationParticipant.createMany({
      data: participants.map((p) => ({
        conversationId: p.conversationId,
        userId: p.userId,
        role: p.role,
        status: ParticipantStatus.ACTIVE,
      })),
      skipDuplicates: true,
    });
  }

  async findParticipant(conversationId: string, userId: string) {
    return this.prisma.conversationParticipant.findUnique({
      where: {
        conversationId_userId: { conversationId, userId },
      },
    });
  }

  async findActiveParticipant(conversationId: string, userId: string) {
    return this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        status: ParticipantStatus.ACTIVE,
      },
    });
  }

  async findActiveParticipantsByConversation(conversationId: string) {
    return this.prisma.conversationParticipant.findMany({
      where: {
        conversationId,
        status: ParticipantStatus.ACTIVE,
      },
    });
  }

  async updateParticipant(
    conversationId: string,
    userId: string,
    data: {
      role?: ParticipantRole;
      status?: ParticipantStatus;
      leftAt?: Date;
      mutedUntil?: Date | null;
      archivedAt?: Date | null;
    },
  ) {
    return this.prisma.conversationParticipant.update({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      data,
    });
  }

  // ─── User conversations ────────────────────────────────────────────

  async findUserConversations(userId: string) {
    return this.prisma.conversationParticipant.findMany({
      where: {
        userId,
        status: ParticipantStatus.ACTIVE,
      },
      include: {
        conversation: {
          include: {
            participants: {
              where: { status: ParticipantStatus.ACTIVE },
              select: {
                id: true,
                userId: true,
                role: true,
                status: true,
                joinedAt: true,
              },
            },
            groupDetail: true,
          },
        },
      },
      orderBy: { conversation: { updatedAt: 'desc' } },
    });
  }

  // ─── Duplicate detection ───────────────────────────────────────────

  async findExistingDirectConversation(
    userIdA: string,
    userIdB: string,
  ) {
    // Find a DIRECT conversation where both users are active participants
    const conversations = await this.prisma.conversation.findMany({
      where: {
        type: ConversationType.DIRECT,
        status: ConversationStatus.ACTIVE,
        participants: {
          every: {
            status: ParticipantStatus.ACTIVE,
          },
        },
      },
      include: {
        participants: {
          where: { status: ParticipantStatus.ACTIVE },
          select: { userId: true },
        },
      },
    });

    return conversations.find((conv) => {
      const participantIds = conv.participants.map((p) => p.userId);
      return (
        participantIds.length === 2 &&
        participantIds.includes(userIdA) &&
        participantIds.includes(userIdB)
      );
    });
  }

  // ─── GroupDetail CRUD ──────────────────────────────────────────────

  async createGroupDetail(data: { conversationId: string }) {
    return this.prisma.groupDetail.create({
      data: {
        conversationId: data.conversationId,
        joinApprovalMode: GroupJoinApprovalMode.ADMIN_APPROVAL,
        memberAddMode: GroupMemberAddMode.ADMINS_ONLY,
      },
    });
  }

  async updateGroupDetail(
    conversationId: string,
    data: {
      joinApprovalMode?: GroupJoinApprovalMode;
      memberAddMode?: GroupMemberAddMode;
      onlyAdminsCanPost?: boolean;
      onlyAdminsCanEditInfo?: boolean;
      maxMembers?: number;
    },
  ) {
    return this.prisma.groupDetail.update({
      where: { conversationId },
      data,
    });
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
