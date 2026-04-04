import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import {
  REALTIME_REDIS_CHANNEL,
  type RealtimeEnvelope,
} from '@unichat-backend/contracts';

/** JSON.stringify cannot encode bigint (e.g. Prisma `MediaAsset.fileSizeBytes`). */
function stringifyForRealtime(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
}

const MSG_RECENT_KEY = (conversationId: string) =>
  `unichat:conv:${conversationId}:msg_recent`;
const MSG_RECENT_MAX = 100;
const MSG_RECENT_TTL_SEC = 7 * 24 * 3600;

@Injectable()
export class RealtimePublisherService
  implements OnModuleDestroy, OnModuleInit
{
  private readonly logger = new Logger(RealtimePublisherService.name);
  private readonly redis: Redis | null;
  private econnrefusedLogged = false;

  constructor() {
    const url = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
    if (process.env['REDIS_DISABLED'] === 'true') {
      this.redis = null;
      this.logger.warn('Redis publishing disabled (REDIS_DISABLED=true)');
      return;
    }
    this.redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    this.redis.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ECONNREFUSED') {
        if (!this.econnrefusedLogged) {
          this.econnrefusedLogged = true;
          this.logger.warn(
            `Redis not reachable at "${url}" (ECONNREFUSED). Start Redis or set REDIS_URL / REDIS_DISABLED=true. Realtime fan-out from messaging is disabled until Redis is available.`,
          );
        }
        return;
      }
      this.logger.error(`Redis publisher error: ${err.message}`);
    });
    this.redis.on('connect', () => {
      this.econnrefusedLogged = false;
    });
  }

  onModuleInit() {
    if (!this.redis) {
      return;
    }
    void this.redis.connect().catch(() => {
      /* error handler already logs ECONNREFUSED */
    });
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit().catch(() => {
        this.redis?.disconnect();
      });
    }
  }

  /** Append serialized message to a per-conversation Redis list (newest first). */
  private pushRecentMessageCache(
    conversationId: string,
    messagePayload: unknown,
  ) {
    if (!this.redis) {
      return;
    }
    const line = stringifyForRealtime(messagePayload);
    void this.redis
      .multi()
      .lpush(MSG_RECENT_KEY(conversationId), line)
      .ltrim(MSG_RECENT_KEY(conversationId), 0, MSG_RECENT_MAX - 1)
      .expire(MSG_RECENT_KEY(conversationId), MSG_RECENT_TTL_SEC)
      .exec()
      .catch((err: Error) =>
        this.logger.warn(`Redis message tail cache failed: ${err.message}`),
      );
  }

  private publish(envelope: RealtimeEnvelope) {
    if (!this.redis) {
      this.logger.debug(
        `Skipping realtime publish (${envelope.type}): no Redis`,
      );
      return;
    }
    const message = stringifyForRealtime(envelope);
    if (envelope.type === 'MESSAGE_CREATED' && envelope.payload != null) {
      const p = envelope.payload as { conversationId?: unknown };
      if (typeof p.conversationId === 'string') {
        this.pushRecentMessageCache(p.conversationId, envelope.payload);
      }
    }
    void this.redis
      .publish(REALTIME_REDIS_CHANNEL, message)
      .catch((err: Error) =>
        this.logger.warn(`Realtime publish failed: ${err.message}`),
      );
  }

  publishMessageCreated(payload: unknown) {
    this.publish({ type: 'MESSAGE_CREATED', payload });
  }

  publishMessageEdited(payload: unknown) {
    this.publish({ type: 'MESSAGE_EDITED', payload });
  }

  publishMessageDeleted(payload: unknown) {
    this.publish({ type: 'MESSAGE_DELETED', payload });
  }

  publishMessageStatusUpdated(payload: unknown) {
    this.publish({ type: 'MESSAGE_STATUS_UPDATED', payload });
  }
}
