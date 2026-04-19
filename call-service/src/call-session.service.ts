import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CACHE } from './redis.tokens';

export type CallMode = 'voice' | 'video';

export type CallState = 'ringing' | 'active';

export interface CallSessionRecord {
  callId: string;
  callerId: string;
  calleeId: string;
  mode: CallMode;
  state: CallState;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CALL_KEY_TTL_SEC = 3600;

@Injectable()
export class CallSessionService {
  private readonly logger = new Logger(CallSessionService.name);

  constructor(@Inject(REDIS_CACHE) private readonly redis: Redis) {}

  private key(callId: string): string {
    return `unichat:call:${callId}`;
  }

  isUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID_RE.test(value);
  }

  async createRingingSession(
    callerId: string,
    calleeId: string,
    mode: CallMode,
  ): Promise<CallSessionRecord> {
    const callId = randomUUID();
    const rec: CallSessionRecord = {
      callId,
      callerId,
      calleeId,
      mode,
      state: 'ringing',
    };
    await this.redis.setex(
      this.key(callId),
      CALL_KEY_TTL_SEC,
      JSON.stringify(rec),
    );
    return rec;
  }

  async getSession(callId: string): Promise<CallSessionRecord | null> {
    const raw = await this.redis.get(this.key(callId));
    if (!raw) {
      return null;
    }
    try {
      const p = JSON.parse(raw) as CallSessionRecord;
      if (
        p &&
        this.isUuid(p.callId) &&
        this.isUuid(p.callerId) &&
        this.isUuid(p.calleeId) &&
        (p.mode === 'voice' || p.mode === 'video') &&
        (p.state === 'ringing' || p.state === 'active')
      ) {
        return p;
      }
    } catch {
      /* fall through */
    }
    this.logger.warn(`Corrupt call session ${callId}`);
    return null;
  }

  async setActive(callId: string): Promise<CallSessionRecord | null> {
    const s = await this.getSession(callId);
    if (!s || s.state !== 'ringing') {
      return null;
    }
    const next: CallSessionRecord = { ...s, state: 'active' };
    await this.redis.setex(
      this.key(callId),
      CALL_KEY_TTL_SEC,
      JSON.stringify(next),
    );
    return next;
  }

  async deleteSession(callId: string): Promise<void> {
    await this.redis.del(this.key(callId));
  }

  otherUserId(session: CallSessionRecord, userId: string): string | null {
    if (session.callerId === userId) {
      return session.calleeId;
    }
    if (session.calleeId === userId) {
      return session.callerId;
    }
    return null;
  }
}
