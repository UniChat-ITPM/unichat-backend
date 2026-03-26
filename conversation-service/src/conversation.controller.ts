import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConversationService } from './conversation.service';
import {
  CreatePrivateConversationBody,
  CreateGroupConversationBody,
  AddParticipantsBody,
  UpdateGroupSettingsBody,
  MuteConversationBody,
  ArchiveConversationBody,
} from './types/conversation.types';

@Controller('conversations')
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  // ─── Private helper ────────────────────────────────────────────────

  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  private getUserId(xUserId: string): string {
    if (!xUserId) {
      throw new UnauthorizedException('Missing x-user-id header');
    }
    if (!this.isValidUUID(xUserId)) {
      throw new BadRequestException(
        `Invalid user ID format. Expected a valid UUID, received: "${xUserId}"`,
      );
    }
    return xUserId;
  }

  // ─── Endpoints ─────────────────────────────────────────────────────

  @Post('private')
  createPrivate(
    @Headers('x-user-id') xUserId: string,
    @Body() body: CreatePrivateConversationBody,
  ) {
    return this.conversationService.createPrivateConversation(
      this.getUserId(xUserId),
      body,
    );
  }

  @Post('group')
  createGroup(
    @Headers('x-user-id') xUserId: string,
    @Body() body: CreateGroupConversationBody,
  ) {
    return this.conversationService.createGroupConversation(
      this.getUserId(xUserId),
      body,
    );
  }

  @Get()
  getAll(@Headers('x-user-id') xUserId: string) {
    return this.conversationService.getUserConversations(
      this.getUserId(xUserId),
    );
  }

  @Get(':id')
  getById(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
  ) {
    return this.conversationService.getConversationById(
      this.getUserId(xUserId),
      id,
    );
  }

  @Post(':id/participants')
  addParticipants(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
    @Body() body: AddParticipantsBody,
  ) {
    return this.conversationService.addParticipants(
      this.getUserId(xUserId),
      id,
      body,
    );
  }

  @Delete(':id/participants/:userId')
  removeParticipant(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.conversationService.removeParticipant(
      this.getUserId(xUserId),
      id,
      targetUserId,
    );
  }

  @Patch(':id/admins/:userId/promote')
  promote(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.conversationService.promoteToAdmin(
      this.getUserId(xUserId),
      id,
      targetUserId,
    );
  }

  @Patch(':id/admins/:userId/demote')
  demote(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.conversationService.demoteAdmin(
      this.getUserId(xUserId),
      id,
      targetUserId,
    );
  }

  @Post(':id/leave')
  leave(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
  ) {
    return this.conversationService.leaveConversation(
      this.getUserId(xUserId),
      id,
    );
  }

  @Patch(':id/settings')
  updateSettings(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
    @Body() body: UpdateGroupSettingsBody,
  ) {
    return this.conversationService.updateGroupSettings(
      this.getUserId(xUserId),
      id,
      body,
    );
  }

  @Patch(':id/mute')
  mute(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
    @Body() body: MuteConversationBody,
  ) {
    return this.conversationService.muteConversation(
      this.getUserId(xUserId),
      id,
      body,
    );
  }

  @Patch(':id/archive')
  archive(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
    @Body() body: ArchiveConversationBody,
  ) {
    return this.conversationService.archiveConversation(
      this.getUserId(xUserId),
      id,
      body,
    );
  }
}
