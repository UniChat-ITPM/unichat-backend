import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  REALTIME_REDIS_CHANNEL,
  type RealtimeEnvelope,
} from '@unichat-backend/contracts';
import Redis from 'ioredis';
import { ChatGateway } from './chat.gateway';
import { REDIS_SUBSCRIBER } from './redis.tokens';

@Injectable()
export class RedisRealtimeSubscriber
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RedisRealtimeSubscriber.name);

  constructor(
    private readonly chatGateway: ChatGateway,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriberRedis: Redis,
  ) {}

  async onApplicationBootstrap() {
    this.subscriberRedis.on('message', (channel, message) => {
      if (channel !== REALTIME_REDIS_CHANNEL) {
        return;
      }
      try {
        const envelope = JSON.parse(message) as RealtimeEnvelope;
        this.chatGateway.dispatchEnvelope(envelope);
      } catch (e) {
        this.logger.warn(`Invalid realtime payload: ${e}`);
      }
    });
    await this.subscriberRedis.subscribe(REALTIME_REDIS_CHANNEL);
    this.logger.log(`Subscribed to Redis channel ${REALTIME_REDIS_CHANNEL}`);
  }

  async onModuleDestroy() {
    await this.subscriberRedis.unsubscribe(REALTIME_REDIS_CHANNEL);
    await this.subscriberRedis.quit();
  }
}
