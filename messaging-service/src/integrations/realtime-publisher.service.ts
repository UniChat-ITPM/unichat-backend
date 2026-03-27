import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import {
  REALTIME_REDIS_CHANNEL,
  type RealtimeEnvelope,
} from '@unichat-backend/contracts';

@Injectable()
export class RealtimePublisherService implements OnModuleDestroy {
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
      lazyConnect: true,
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

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit().catch(() => {
        this.redis?.disconnect();
      });
    }
  }

  private publish(envelope: RealtimeEnvelope) {
    if (!this.redis) {
      this.logger.debug(
        `Skipping realtime publish (${envelope.type}): no Redis`,
      );
      return;
    }
    const message = JSON.stringify(envelope);
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
