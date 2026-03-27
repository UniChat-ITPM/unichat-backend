import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [RealtimeModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
