import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { ChatGateway } from './chat.gateway';
import { ConversationMembershipService } from './conversation-membership.service';
import { SocketAuthService } from './socket-auth.service';
import { RedisCacheLifecycle } from './redis-cache-lifecycle.service';
import { RedisRealtimeSubscriber } from './redis-realtime-subscriber.service';
import { REDIS_CACHE, REDIS_SUBSCRIBER } from './redis.tokens';
import { RealtimeController } from './realtime.controller';

function redisUrl(): string {
  return process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
}

@Module({
  controllers: [RealtimeController],
  providers: [
    {
      provide: REDIS_CACHE,
      useFactory: (): Redis =>
        new Redis(redisUrl(), { maxRetriesPerRequest: 3 }),
    },
    {
      provide: REDIS_SUBSCRIBER,
      useFactory: (): Redis =>
        new Redis(redisUrl(), {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        }),
    },
    RedisCacheLifecycle,
    SocketAuthService,
    ConversationMembershipService,
    ChatGateway,
    RedisRealtimeSubscriber,
  ],
})
export class RealtimeModule {}
