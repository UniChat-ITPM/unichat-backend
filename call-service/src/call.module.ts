import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { CallController } from './call.controller';
import { CallGateway } from './call.gateway';
import { CallSessionService } from './call-session.service';
import { RedisCacheLifecycle } from './redis-cache-lifecycle.service';
import { REDIS_CACHE } from './redis.tokens';
import { SocketAuthService } from './socket-auth.service';

function redisUrl(): string {
  return process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
}

@Module({
  controllers: [CallController],
  providers: [
    {
      provide: REDIS_CACHE,
      useFactory: (): Redis =>
        new Redis(redisUrl(), { maxRetriesPerRequest: 3 }),
    },
    RedisCacheLifecycle,
    SocketAuthService,
    CallSessionService,
    CallGateway,
  ],
})
export class CallModule {}
