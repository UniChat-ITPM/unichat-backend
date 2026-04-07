import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ModerationModule } from '../moderation.module';


@Module({
   imports: [ModerationModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
