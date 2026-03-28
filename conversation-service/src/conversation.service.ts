import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ConversationType,
  ParticipantRole,
  ParticipantStatus,
} from '@prisma/client';
import { ConversationRepository } from './repositories/conversation.repository';
import {
  CreatePrivateConversationBody,
  CreateGroupConversationBody,
  AddParticipantsBody,
  UpdateGroupSettingsBody,
  MuteConversationBody,
  ArchiveConversationBody,
} from './types/conversation.types';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(private readonly repo: ConversationRepository) {}

  // ─── UUID Validation Helper ────────────────────────────────────────

  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  private validateUUIDs(uuids: string[]): void {
    for (const uuid of uuids) {
      if (!this.isValidUUID(uuid)) {
        throw new BadRequestException(
          `Invalid UUID format: "${uuid}". Expected a valid UUID (e.g., 550e8400-e29b-41d4-a716-446655440000)`,
        );
      }
    }
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.repo.findUserById(userId);
    if (!user) {
      throw new NotFoundException(`User not found: "${userId}"`);
    }
  }

  private async assertUsersExist(userIds: string[]): Promise<void> {
    const users = await this.repo.findUsersByIds(userIds);
    const foundIds = new Set(users.map((u) => u.id));
    const missing = userIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(
        `User(s) not found: ${missing.map((id) => `"${id}"`).join(', ')}`,
      );
    }
  }

  // ─── Create Private (Direct) Conversation ──────────────────────────

  async createPrivateConversation(
    userId: string,
    body: CreatePrivateConversationBody,
  ) {
    const { participantUserId } = body;

    // Validate UUID format
    this.validateUUIDs([participantUserId]);

    if (participantUserId === userId) {
      throw new BadRequestException('Cannot create a conversation with yourself');
    }

    // Verify both users exist in the database
    await this.assertUsersExist([userId, participantUserId]);

    // Prevent duplicate direct conversations
    const existing = await this.repo.findExistingDirectConversation(
      userId,
      participantUserId,
    );
    if (existing) {
      return {
        success: true,
        message: 'Conversation already exists',
        conversation: existing,
      };
    }

    const conversation = await this.repo.createConversation({
      type: ConversationType.DIRECT,
      createdByUserId: userId,
    });

    await this.repo.createManyParticipants([
      {
        conversationId: conversation.id,
        userId,
        role: ParticipantRole.MEMBER,
      },
      {
        conversationId: conversation.id,
        userId: participantUserId,
        role: ParticipantRole.MEMBER,
      },
    ]);

    const full = await this.repo.findConversationById(conversation.id);

    this.logger.log(
      `Private conversation created: ${conversation.id} between ${userId} and ${participantUserId}`,
    );

    return { success: true, message: 'Private conversation created', conversation: full };
  }

  // ─── Create Group Conversation ─────────────────────────────────────

  async createGroupConversation(
    userId: string,
    body: CreateGroupConversationBody,
  ) {
    const { title, imageUrl, participantUserIds } = body;

    if (!title || title.trim().length === 0) {
      throw new BadRequestException('Group title is required');
    }

    // Validate all participant user IDs
    if (participantUserIds && participantUserIds.length > 0) {
      this.validateUUIDs(participantUserIds);
    }

    // Verify all users (creator + participants) exist in the database
    const allUserIds = [userId, ...(participantUserIds ?? []).filter((id) => id !== userId)];
    await this.assertUsersExist(allUserIds);

    const conversation = await this.repo.createConversation({
      type: ConversationType.GROUP,
      title: title.trim(),
      imageUrl,
      createdByUserId: userId,
    });

    // Creator is OWNER
    const participants = [
      {
        conversationId: conversation.id,
        userId,
        role: ParticipantRole.OWNER,
      },
      ...(participantUserIds ?? [])
        .filter((id) => id !== userId)
        .map((id) => ({
          conversationId: conversation.id,
          userId: id,
          role: ParticipantRole.MEMBER as ParticipantRole,
        })),
    ];

    await this.repo.createManyParticipants(participants);
    await this.repo.createGroupDetail({ conversationId: conversation.id });

    const full = await this.repo.findConversationById(conversation.id);

    this.logger.log(`Group conversation created: ${conversation.id} by ${userId}`);

    return { success: true, message: 'Group conversation created', conversation: full };
  }

  // ─── Get All Conversations for User ────────────────────────────────

  async getUserConversations(userId: string) {
    const participantRecords = await this.repo.findUserConversations(userId);

    const conversations = participantRecords.map((p) => {
      const c = p.conversation;
      const lastMsg = c.messages?.[0];
      let lastMessageText =
        (lastMsg?.rawText ?? lastMsg?.caption ?? '').trim() || null;
      if (!lastMessageText && lastMsg?.type) {
        const t = lastMsg.type;
        if (t === 'IMAGE' || t === 'STICKER') {
          lastMessageText = '📷 Photo';
        } else if (t === 'VIDEO') {
          lastMessageText = '🎥 Video';
        } else if (t === 'AUDIO') {
          lastMessageText = '🎤 Voice message';
        } else if (t === 'DOCUMENT') {
          lastMessageText = '📎 File';
        }
      }
      const participantRows = c.participants ?? [];
      const participants = participantRows.map((x) => ({
        userId: x.userId,
        displayName: x.user?.displayName ?? null,
        username: x.user?.username ?? null,
        profilePhoto: x.user?.avatarUrl ?? null,
      }));
      let peerDisplayName: string | null = null;
      let peerUsername: string | null = null;
      let peerUserId: string | null = null;
      if (c.type === ConversationType.DIRECT && participants.length === 2) {
        const other = participants.find((x) => x.userId !== userId);
        if (other) {
          peerUserId = other.userId;
          peerDisplayName =
            other.displayName?.trim() || other.username?.trim() || null;
          peerUsername = other.username?.trim() ?? null;
        }
      }
      const { messages: _m, participants: _pr, ...convRest } = c;
      return {
        ...convRest,
        participants,
        peerDisplayName,
        peerUsername,
        peerUserId,
        lastMessageText,
        myRole: p.role,
        isMuted: p.mutedUntil ? new Date(p.mutedUntil) > new Date() : false,
        isArchived: !!p.archivedAt,
      };
    });

    return { success: true, conversations };
  }

  // ─── Get Conversation by ID ────────────────────────────────────────

  async getConversationById(userId: string, conversationId: string) {
    const conversation = await this.repo.findConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    await this.getActiveParticipantOrFail(conversationId, userId);

    return { success: true, conversation };
  }

  // ─── Add Participants ──────────────────────────────────────────────

  async addParticipants(
    userId: string,
    conversationId: string,
    body: AddParticipantsBody,
  ) {
    const conversation = await this.getConversationOrFail(conversationId);
    this.assertGroupConversation(conversation);
    await this.assertAdminOrOwner(conversationId, userId);

    const { userIds } = body;
    if (!userIds || userIds.length === 0) {
      throw new BadRequestException('At least one user ID is required');
    }

    // Validate all user IDs
    this.validateUUIDs(userIds);

    // Verify all users exist in the database
    await this.assertUsersExist(userIds);

    // Filter out users who are already active participants
    const existing = await this.repo.findActiveParticipantsByConversation(conversationId);
    const existingUserIds = new Set(existing.map((p) => p.userId));
    const newUserIds = userIds.filter((id) => !existingUserIds.has(id));

    if (newUserIds.length === 0) {
      return { success: true, message: 'All users are already participants', addedCount: 0 };
    }

    // Check if any of these users were previously removed/left — reactivate them
    for (const uid of newUserIds) {
      const prev = await this.repo.findParticipant(conversationId, uid);
      if (prev) {
        await this.repo.updateParticipant(conversationId, uid, {
          status: ParticipantStatus.ACTIVE,
          role: ParticipantRole.MEMBER,
          leftAt: undefined,
        });
      }
    }

    // Create new participant records for truly new users
    const trulyNew = [];
    for (const uid of newUserIds) {
      const prev = await this.repo.findParticipant(conversationId, uid);
      if (!prev) {
        trulyNew.push({
          conversationId,
          userId: uid,
          role: ParticipantRole.MEMBER as ParticipantRole,
        });
      }
    }

    if (trulyNew.length > 0) {
      await this.repo.createManyParticipants(trulyNew);
    }

    this.logger.log(
      `Added ${newUserIds.length} participants to conversation ${conversationId}`,
    );

    return {
      success: true,
      message: `${newUserIds.length} participant(s) added`,
      addedCount: newUserIds.length,
    };
  }

  // ─── Remove Participant ────────────────────────────────────────────

  async removeParticipant(
    userId: string,
    conversationId: string,
    targetUserId: string,
  ) {
    // Validate UUIDs
    this.validateUUIDs([targetUserId]);

    const conversation = await this.getConversationOrFail(conversationId);
    this.assertGroupConversation(conversation);
    await this.assertAdminOrOwner(conversationId, userId);

    if (targetUserId === userId) {
      throw new BadRequestException(
        'Cannot remove yourself. Use the leave endpoint instead.',
      );
    }

    const target = await this.getActiveParticipantOrFail(conversationId, targetUserId);

    // Cannot remove the OWNER
    if (target.role === ParticipantRole.OWNER) {
      throw new ForbiddenException('Cannot remove the group owner');
    }

    // An ADMIN cannot remove another ADMIN (only OWNER can)
    const actor = await this.getActiveParticipantOrFail(conversationId, userId);
    if (
      target.role === ParticipantRole.ADMIN &&
      actor.role !== ParticipantRole.OWNER
    ) {
      throw new ForbiddenException('Only the group owner can remove an admin');
    }

    await this.repo.updateParticipant(conversationId, targetUserId, {
      status: ParticipantStatus.REMOVED,
      leftAt: new Date(),
    });

    this.logger.log(
      `User ${targetUserId} removed from conversation ${conversationId} by ${userId}`,
    );

    return { success: true, message: 'Participant removed' };
  }

  // ─── Promote to Admin ──────────────────────────────────────────────

  async promoteToAdmin(
    userId: string,
    conversationId: string,
    targetUserId: string,
  ) {
    // Validate UUID
    this.validateUUIDs([targetUserId]);

    const conversation = await this.getConversationOrFail(conversationId);
    this.assertGroupConversation(conversation);
    await this.assertAdminOrOwner(conversationId, userId);

    const target = await this.getActiveParticipantOrFail(conversationId, targetUserId);

    if (target.role === ParticipantRole.ADMIN || target.role === ParticipantRole.OWNER) {
      throw new BadRequestException('User is already an admin or owner');
    }

    await this.repo.updateParticipant(conversationId, targetUserId, {
      role: ParticipantRole.ADMIN,
    });

    this.logger.log(
      `User ${targetUserId} promoted to admin in conversation ${conversationId}`,
    );

    return { success: true, message: 'User promoted to admin' };
  }

  // ─── Demote Admin ──────────────────────────────────────────────────

  async demoteAdmin(
    userId: string,
    conversationId: string,
    targetUserId: string,
  ) {
    // Validate UUID
    this.validateUUIDs([targetUserId]);

    const conversation = await this.getConversationOrFail(conversationId);
    this.assertGroupConversation(conversation);
    await this.assertAdminOrOwner(conversationId, userId);

    const target = await this.getActiveParticipantOrFail(conversationId, targetUserId);

    if (target.role === ParticipantRole.OWNER) {
      throw new ForbiddenException('Cannot demote the group owner');
    }

    if (target.role !== ParticipantRole.ADMIN) {
      throw new BadRequestException('User is not an admin');
    }

    // Only OWNER can demote an admin
    const actor = await this.getActiveParticipantOrFail(conversationId, userId);
    if (actor.role !== ParticipantRole.OWNER) {
      throw new ForbiddenException('Only the group owner can demote admins');
    }

    await this.repo.updateParticipant(conversationId, targetUserId, {
      role: ParticipantRole.MEMBER,
    });

    this.logger.log(
      `User ${targetUserId} demoted to member in conversation ${conversationId}`,
    );

    return { success: true, message: 'Admin demoted to member' };
  }

  // ─── Leave Conversation ────────────────────────────────────────────

  async leaveConversation(userId: string, conversationId: string) {
    const conversation = await this.getConversationOrFail(conversationId);
    const participant = await this.getActiveParticipantOrFail(conversationId, userId);

    // OWNER cannot leave a group without transferring ownership
    if (
      conversation.type === ConversationType.GROUP &&
      participant.role === ParticipantRole.OWNER
    ) {
      // Auto-transfer to the next available admin, or the oldest member
      const others = await this.repo.findActiveParticipantsByConversation(conversationId);
      const candidates = others
        .filter((p) => p.userId !== userId)
        .sort((a, b) => {
          const rolePriority = { ADMIN: 0, MEMBER: 1, OWNER: 2 };
          return (
            (rolePriority[a.role] ?? 99) - (rolePriority[b.role] ?? 99) ||
            a.joinedAt.getTime() - b.joinedAt.getTime()
          );
        });

      if (candidates.length > 0) {
        await this.repo.updateParticipant(conversationId, candidates[0].userId, {
          role: ParticipantRole.OWNER,
        });
        this.logger.log(
          `Ownership transferred to ${candidates[0].userId} in conversation ${conversationId}`,
        );
      }
    }

    await this.repo.updateParticipant(conversationId, userId, {
      status: ParticipantStatus.LEFT,
      leftAt: new Date(),
    });

    this.logger.log(`User ${userId} left conversation ${conversationId}`);

    return { success: true, message: 'You have left the conversation' };
  }

  // ─── Update Group Settings ─────────────────────────────────────────

  async updateGroupSettings(
    userId: string,
    conversationId: string,
    body: UpdateGroupSettingsBody,
  ) {
    const conversation = await this.getConversationOrFail(conversationId);
    this.assertGroupConversation(conversation);
    await this.assertAdminOrOwner(conversationId, userId);

    const { title, description, imageUrl, ...groupSettings } = body;

    // Update conversation-level metadata
    if (title !== undefined || description !== undefined || imageUrl !== undefined) {
      await this.repo.updateConversation(conversationId, {
        ...(title !== undefined && { title: title.trim() }),
        ...(description !== undefined && { description }),
        ...(imageUrl !== undefined && { imageUrl }),
      });
    }

    // Update group-detail-level settings
    if (Object.keys(groupSettings).length > 0) {
      await this.repo.updateGroupDetail(conversationId, groupSettings);
    }

    const updated = await this.repo.findConversationById(conversationId);

    this.logger.log(`Group settings updated for conversation ${conversationId}`);

    return { success: true, message: 'Group settings updated', conversation: updated };
  }

  // ─── Mute Conversation ─────────────────────────────────────────────

  async muteConversation(
    userId: string,
    conversationId: string,
    body: MuteConversationBody,
  ) {
    await this.getConversationOrFail(conversationId);
    await this.getActiveParticipantOrFail(conversationId, userId);

    const mutedUntil = body.muted
      ? body.mutedUntil
        ? new Date(body.mutedUntil)
        : new Date('9999-12-31') // mute indefinitely
      : null;

    await this.repo.updateParticipant(conversationId, userId, { mutedUntil });

    return {
      success: true,
      message: body.muted ? 'Conversation muted' : 'Conversation unmuted',
    };
  }

  // ─── Archive Conversation ──────────────────────────────────────────

  async archiveConversation(
    userId: string,
    conversationId: string,
    body: ArchiveConversationBody,
  ) {
    await this.getConversationOrFail(conversationId);
    await this.getActiveParticipantOrFail(conversationId, userId);

    const archivedAt = body.archived ? new Date() : null;

    await this.repo.updateParticipant(conversationId, userId, { archivedAt });

    return {
      success: true,
      message: body.archived ? 'Conversation archived' : 'Conversation unarchived',
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private async getConversationOrFail(conversationId: string) {
    const conversation = await this.repo.findConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  private async getActiveParticipantOrFail(
    conversationId: string,
    userId: string,
  ) {
    const participant = await this.repo.findActiveParticipant(conversationId, userId);
    if (!participant) {
      throw new ForbiddenException(
        'You are not an active participant of this conversation',
      );
    }
    return participant;
  }

  private async assertAdminOrOwner(conversationId: string, userId: string) {
    const participant = await this.getActiveParticipantOrFail(conversationId, userId);
    if (
      participant.role !== ParticipantRole.ADMIN &&
      participant.role !== ParticipantRole.OWNER
    ) {
      throw new ForbiddenException('Only admins can perform this action');
    }
    return participant;
  }

  private assertGroupConversation(conversation: { type: ConversationType }) {
    if (conversation.type !== ConversationType.GROUP) {
      throw new BadRequestException('This action is only available for group conversations');
    }
  }
}
