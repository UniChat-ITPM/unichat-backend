import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CACHE } from './redis.tokens';

@Injectable()
export class RedisCacheLifecycle implements OnModuleDestroy {
  constructor(@Inject(REDIS_CACHE) private readonly redis: Redis) {}

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
