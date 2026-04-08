import { Module } from '@nestjs/common';
import { CallModule } from '../call.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [CallModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
