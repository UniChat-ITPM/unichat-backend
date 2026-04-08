import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { BackendProxyService } from './backend-proxy.service';
import { ConversationsProxyController } from './conversations-proxy.controller';
import { MessagingProxyController } from './messaging-proxy.controller';
import { CallProxyController } from './call-proxy.controller';
import { ModerationProxyController } from './moderation-proxy.controller';
import { RealtimeProxyController } from './realtime-proxy.controller';
import { UserApiController } from './user-api.controller';
import { UsersMatchContactsController } from './users-match-contacts.controller';
import { JwtBearerUserService } from './jwt-bearer-user.service';
import { ContactMatchRateLimiterService } from './contact-match-rate-limiter.service';

@Module({
  controllers: [
    ApiController,
    UserApiController,
    UsersMatchContactsController,
    ConversationsProxyController,
    MessagingProxyController,
    ModerationProxyController,
    RealtimeProxyController,
    CallProxyController,
  ],
  providers: [
    ApiService,
    BackendProxyService,
    JwtBearerUserService,
    ContactMatchRateLimiterService,
  ],
})
export class ApiModule {}
