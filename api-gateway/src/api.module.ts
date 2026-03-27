import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { UserApiController } from './user-api.controller';

@Module({
  controllers: [ApiController, UserApiController],
  providers: [ApiService],
})
export class ApiModule {}
