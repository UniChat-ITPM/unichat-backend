/**
 * Call microservice: WebRTC signaling (1:1 voice/video) + ICE config HTTP.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadWorkspaceEnv } from '../../workspace-env/load-env';
import { AppModule } from './app/app.module';
import { RedisIoAdapter } from './redis-io.adapter';

loadWorkspaceEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  app.enableCors({
    origin: process.env['CORS_ORIGIN']?.split(',') ?? true,
    credentials: true,
  });
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const port = Number(process.env['CALL_SERVICE_PORT']) || 8229;
  await app.listen(port);
  Logger.log(
    `🚀 call-service on: http://localhost:${port}/${globalPrefix} (Socket.IO path /call/socket.io)`,
  );
}

bootstrap();
