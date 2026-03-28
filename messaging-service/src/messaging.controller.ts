import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  UnauthorizedException,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MessagingService } from './messaging.service';
import { ChatMediaService } from './chat-media.service';
import { SendTextMessageDto, SendMediaMessageDto, EditMessageDto, MessagePaginationDto } from './dto/message.dto';

const UPLOAD_LIMIT = 25 * 1024 * 1024;

@Controller('messages')
export class MessagingController {
  constructor(
    private readonly messagingService: MessagingService,
    private readonly chatMediaService: ChatMediaService,
  ) {}

  // ─── Helper ────────────────────────────────────────────────────────

  private getUserId(xUserId: string): string {
    if (!xUserId) {
      throw new UnauthorizedException('Missing x-user-id header');
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(xUserId)) {
      throw new BadRequestException('Invalid user ID format');
    }
    return xUserId;
  }

  // ─── Endpoints ─────────────────────────────────────────────────────

  @Post('text')
  async sendTextMessage(
    @Headers('x-user-id') xUserId: string,
    @Body() dto: SendTextMessageDto,
  ) {
    return this.messagingService.sendTextMessage(this.getUserId(xUserId), dto);
  }

  @Post('media')
  async sendMediaMessage(
    @Headers('x-user-id') xUserId: string,
    @Body() dto: SendMediaMessageDto,
  ) {
    return this.messagingService.sendMediaMessage(this.getUserId(xUserId), dto);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: UPLOAD_LIMIT },
    }),
  )
  async uploadChatMedia(
    @Headers('x-user-id') xUserId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('file is required (multipart field name: file)');
    }
    return this.chatMediaService.uploadForUser(this.getUserId(xUserId), file);
  }

  @Post(':id/forward')
  async forwardMessage(
    @Headers('x-user-id') xUserId: string,
    @Param('id') messageId: string,
    @Body('targetConversationId') targetConversationId: string,
  ) {
    if (!targetConversationId) throw new BadRequestException('targetConversationId required');
    return this.messagingService.forwardMessage(this.getUserId(xUserId), messageId, targetConversationId);
  }

  @Get('conversation/:conversationId')
  async getConversationMessages(
    @Headers('x-user-id') xUserId: string,
    @Param('conversationId') conversationId: string,
    @Query() query: MessagePaginationDto,
  ) {
    return this.messagingService.getConversationMessages(
      this.getUserId(xUserId),
      conversationId,
      query.limit || 50,
      query.cursor,
    );
  }

  @Get('unread-counts/:conversationId')
  async getUnreadCount(
    @Headers('x-user-id') xUserId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.messagingService.getUnreadCount(this.getUserId(xUserId), conversationId);
  }

  @Get(':id')
  async getMessageById(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
  ) {
    return this.messagingService.getMessageById(this.getUserId(xUserId), id);
  }

  @Patch(':id/delivered')
  async markAsDelivered(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
  ) {
    return this.messagingService.markAsDelivered(this.getUserId(xUserId), id);
  }

  @Patch(':id/read')
  async markAsRead(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
  ) {
    return this.messagingService.markAsRead(this.getUserId(xUserId), id);
  }

  @Patch(':id/edit')
  async editMessage(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.messagingService.editMessage(this.getUserId(xUserId), id, dto.newText);
  }

  @Delete(':id')
  async deleteMessage(
    @Headers('x-user-id') xUserId: string,
    @Param('id') id: string,
  ) {
    return this.messagingService.deleteMessage(this.getUserId(xUserId), id);
  }
}
