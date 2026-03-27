import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { BackendProxyService } from './backend-proxy.service';
import { ConversationsProxyController } from './conversations-proxy.controller';
import { MessagingProxyController } from './messaging-proxy.controller';
import { RealtimeProxyController } from './realtime-proxy.controller';
import { UserApiController } from './user-api.controller';

@Module({
  controllers: [
    ApiController,
    UserApiController,
    ConversationsProxyController,
    MessagingProxyController,
    RealtimeProxyController,
  ],
  providers: [ApiService, BackendProxyService],
})
export class ApiModule {}
