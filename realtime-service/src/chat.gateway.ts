import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  conversationRoom,
  type RealtimeEnvelope,
} from '@unichat-backend/contracts';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import { ConversationMembershipService } from './conversation-membership.service';
import { REDIS_CACHE } from './redis.tokens';
import { SocketAuthService } from './socket-auth.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@WebSocketGateway({
  cors: {
    origin: process.env['SOCKET_CORS_ORIGIN']?.split(',') ?? true,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60_000,
  pingInterval: 25_000,
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly membership: ConversationMembershipService,
    private readonly socketAuth: SocketAuthService,
    @Inject(REDIS_CACHE) private readonly redis: Redis,
  ) {}

  async handleConnection(client: Socket) {
    let userId = this.socketAuth.verifyUserIdFromHandshake(client);
    if (!userId && process.env['SOCKET_AUTH_LEGACY_USER_ID'] === 'true') {
      const legacy =
        (client.handshake.auth as { userId?: string })?.userId ??
        (client.handshake.query['userId'] as string | undefined);
      if (legacy && UUID_RE.test(legacy)) {
        userId = legacy;
      }
    }
    if (!userId) {
      this.logger.warn(`Rejecting socket ${client.id}: invalid or missing token`);
      client.disconnect(true);
      return;
    }
    client.data['userId'] = userId;
    try {
      await this.redis.sadd(`unichat:user:${userId}:sockets`, client.id);
      await this.redis.expire(`unichat:user:${userId}:sockets`, 86400);
    } catch (e) {
      this.logger.warn(`Redis presence: ${e}`);
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data['userId'] as string | undefined;
    if (!userId) return;
    try {
      await this.redis.srem(`unichat:user:${userId}:sockets`, client.id);
    } catch (e) {
      this.logger.warn(`Redis presence cleanup: ${e}`);
    }
  }

  @SubscribeMessage('join_conversation')
  async joinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ) {
    const userId = client.data['userId'] as string | undefined;
    if (!userId) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    const conversationId = body?.conversationId;
    if (!conversationId || !UUID_RE.test(conversationId)) {
      return { ok: false, error: 'INVALID_CONVERSATION' };
    }
    const allowed = await this.membership.isActiveMember(
      conversationId,
      userId,
    );
    if (!allowed) {
      return { ok: false, error: 'FORBIDDEN' };
    }
    await client.join(conversationRoom(conversationId));
    return { ok: true };
  }

  @SubscribeMessage('leave_conversation')
  async leaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ) {
    const conversationId = body?.conversationId;
    if (!conversationId || !UUID_RE.test(conversationId)) {
      return { ok: false, error: 'INVALID_CONVERSATION' };
    }
    await client.leave(conversationRoom(conversationId));
    return { ok: true };
  }

  dispatchEnvelope(envelope: RealtimeEnvelope) {
    if (!this.server) {
      return;
    }
    const cid = this.extractConversationId(envelope);
    if (!cid) {
      this.logger.warn(
        `Skipping realtime ${envelope.type}: missing conversationId`,
      );
      return;
    }
    this.server.to(conversationRoom(cid)).emit('realtime', envelope);
  }

  private extractConversationId(
    envelope: RealtimeEnvelope,
  ): string | undefined {
    const p = envelope.payload;
    if (p && typeof p === 'object' && 'conversationId' in p) {
      const v = (p as { conversationId: unknown }).conversationId;
      if (typeof v === 'string' && UUID_RE.test(v)) {
        return v;
      }
    }
    return undefined;
  }
}
