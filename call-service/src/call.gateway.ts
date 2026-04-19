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
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import { CallSessionService, type CallMode } from './call-session.service';
import { REDIS_CACHE } from './redis.tokens';
import { SocketAuthService } from './socket-auth.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** WebRTC signaling + 1:1 call control (separate Socket.IO path from chat). */
@WebSocketGateway({
  path: '/call/socket.io',
  cors: {
    origin: process.env['SOCKET_CORS_ORIGIN']?.split(',') ?? true,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60_000,
  pingInterval: 25_000,
})
export class CallGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CallGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly sessions: CallSessionService,
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
      this.logger.warn(`Rejecting call socket ${client.id}: invalid or missing token`);
      client.disconnect(true);
      return;
    }
    client.data['userId'] = userId;
    try {
      /** Separate from chat realtime (`unichat:user:*`) — those socket ids belong to another process. */
      await this.redis.sadd(`unichat:call:user:${userId}:sockets`, client.id);
      await this.redis.expire(`unichat:call:user:${userId}:sockets`, 86400);
    } catch (e) {
      this.logger.warn(`Redis call presence: ${e}`);
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data['userId'] as string | undefined;
    if (!userId) {
      return;
    }
    try {
      await this.redis.srem(`unichat:call:user:${userId}:sockets`, client.id);
    } catch (e) {
      this.logger.warn(`Redis call presence cleanup: ${e}`);
    }
  }

  private async emitToUser(event: string, userId: string, payload: unknown) {
    const ids = await this.redis.smembers(`unichat:call:user:${userId}:sockets`);
    for (const sid of ids) {
      this.server.to(sid).emit(event, payload);
    }
  }

  private userId(client: Socket): string | undefined {
    return client.data['userId'] as string | undefined;
  }

  private parseMode(raw: unknown): CallMode | null {
    if (raw === 'voice' || raw === 'video') {
      return raw;
    }
    return null;
  }

  /** Optional label from client (caller's display name); forwarded to callee for UI only. */
  private parseCallerDisplayName(raw: unknown): string | undefined {
    if (typeof raw !== 'string') {
      return undefined;
    }
    const t = raw.trim().replace(/\s+/g, ' ');
    if (t.length === 0) {
      return undefined;
    }
    return t.length > 120 ? t.slice(0, 120) : t;
  }

  @SubscribeMessage('call:invite')
  async invite(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      targetUserId?: string;
      mode?: CallMode | string;
      callerDisplayName?: string;
    },
  ) {
    const userId = this.userId(client);
    if (!userId) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    const targetUserId = body?.targetUserId;
    if (!this.sessions.isUuid(targetUserId) || targetUserId === userId) {
      return { ok: false, error: 'INVALID_TARGET' };
    }
    const mode = this.parseMode(body?.mode);
    if (!mode) {
      return { ok: false, error: 'INVALID_MODE' };
    }
    const callerDisplayName = this.parseCallerDisplayName(
      body?.callerDisplayName,
    );
    try {
      const session = await this.sessions.createRingingSession(
        userId,
        targetUserId,
        mode,
      );
      await this.emitToUser('call:incoming', targetUserId, {
        callId: session.callId,
        fromUserId: userId,
        mode: session.mode,
        ...(callerDisplayName ? { callerDisplayName } : {}),
      });
      return { ok: true, callId: session.callId };
    } catch (e) {
      this.logger.warn(`call:invite failed: ${e}`);
      return { ok: false, error: 'INTERNAL' };
    }
  }

  @SubscribeMessage('call:accept')
  async accept(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { callId?: string },
  ) {
    const userId = this.userId(client);
    if (!userId) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    const callId = body?.callId;
    if (!this.sessions.isUuid(callId)) {
      return { ok: false, error: 'INVALID_CALL' };
    }
    const before = await this.sessions.getSession(callId);
    if (!before || before.state !== 'ringing' || before.calleeId !== userId) {
      return { ok: false, error: 'NOT_ALLOWED' };
    }
    const session = await this.sessions.setActive(callId);
    if (!session) {
      return { ok: false, error: 'NOT_ALLOWED' };
    }
    await this.emitToUser('call:accepted', session.callerId, {
      callId: session.callId,
      byUserId: userId,
      mode: session.mode,
    });
    return { ok: true, callId: session.callId };
  }

  @SubscribeMessage('call:reject')
  async reject(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { callId?: string },
  ) {
    return this.endRinging(client, body?.callId, 'call:rejected', true);
  }

  @SubscribeMessage('call:cancel')
  async cancel(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { callId?: string },
  ) {
    return this.endRinging(client, body?.callId, 'call:cancelled', false);
  }

  /** Callee rejects; caller cancels while ringing. */
  private async endRinging(
    client: Socket,
    callId: string | undefined,
    event: 'call:rejected' | 'call:cancelled',
    calleeAction: boolean,
  ) {
    const userId = this.userId(client);
    if (!userId) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    if (!this.sessions.isUuid(callId)) {
      return { ok: false, error: 'INVALID_CALL' };
    }
    const session = await this.sessions.getSession(callId);
    if (!session || session.state !== 'ringing') {
      return { ok: false, error: 'NOT_FOUND' };
    }
    if (calleeAction) {
      if (session.calleeId !== userId) {
        return { ok: false, error: 'NOT_ALLOWED' };
      }
    } else {
      if (session.callerId !== userId) {
        return { ok: false, error: 'NOT_ALLOWED' };
      }
    }
    await this.sessions.deleteSession(callId);
    const peer = this.sessions.otherUserId(session, userId);
    if (peer) {
      await this.emitToUser(event, peer, { callId, byUserId: userId });
    }
    return { ok: true, callId };
  }

  @SubscribeMessage('call:end')
  async end(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { callId?: string },
  ) {
    const userId = this.userId(client);
    if (!userId) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    const callId = body?.callId;
    if (!this.sessions.isUuid(callId)) {
      return { ok: false, error: 'INVALID_CALL' };
    }
    const session = await this.sessions.getSession(callId);
    if (!session) {
      return { ok: false, error: 'NOT_FOUND' };
    }
    const peer = this.sessions.otherUserId(session, userId);
    if (peer == null) {
      return { ok: false, error: 'NOT_ALLOWED' };
    }
    await this.sessions.deleteSession(callId);
    await this.emitToUser('call:ended', peer, { callId, byUserId: userId });
    return { ok: true, callId };
  }

  private async relayWebRtc(
    client: Socket,
    callId: string | undefined,
    event: 'call:offer' | 'call:answer' | 'call:ice',
    payload: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string }> {
    const userId = this.userId(client);
    if (!userId) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    if (!this.sessions.isUuid(callId)) {
      return { ok: false, error: 'INVALID_CALL' };
    }
    const session = await this.sessions.getSession(callId);
    if (!session || session.state !== 'active') {
      return { ok: false, error: 'NOT_ACTIVE' };
    }
    const peer = this.sessions.otherUserId(session, userId);
    if (!peer) {
      return { ok: false, error: 'NOT_ALLOWED' };
    }
    await this.emitToUser(event, peer, { callId, ...payload });
    return { ok: true };
  }

  @SubscribeMessage('call:offer')
  async offer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: { callId?: string; sdp?: string; type?: string },
  ) {
    if (typeof body?.sdp !== 'string' || body.sdp.length === 0) {
      return { ok: false, error: 'INVALID_SDP' };
    }
    const type =
      typeof body.type === 'string' && body.type.length > 0 ? body.type : 'offer';
    return this.relayWebRtc(client, body.callId, 'call:offer', {
      sdp: body.sdp,
      type,
      fromUserId: this.userId(client),
    });
  }

  @SubscribeMessage('call:answer')
  async answer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: { callId?: string; sdp?: string; type?: string },
  ) {
    if (typeof body?.sdp !== 'string' || body.sdp.length === 0) {
      return { ok: false, error: 'INVALID_SDP' };
    }
    const type =
      typeof body.type === 'string' && body.type.length > 0 ? body.type : 'answer';
    return this.relayWebRtc(client, body.callId, 'call:answer', {
      sdp: body.sdp,
      type,
      fromUserId: this.userId(client),
    });
  }

  @SubscribeMessage('call:ice')
  async ice(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      callId?: string;
      candidate?: Record<string, unknown> | null;
    },
  ) {
    const cand = body?.candidate;
    if (cand != null && typeof cand !== 'object') {
      return { ok: false, error: 'INVALID_ICE' };
    }
    return this.relayWebRtc(client, body.callId, 'call:ice', {
      candidate: cand ?? null,
      fromUserId: this.userId(client),
    });
  }
}
