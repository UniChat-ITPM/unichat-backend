/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { loadWorkspaceEnv } from '../../workspace-env/load-env';
import { AppModule } from './app/app.module';

loadWorkspaceEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env['CORS_ORIGIN']?.split(',') ?? true,
    credentials: true,
  });

  const expressApp = app.getHttpAdapter().getInstance() as express.Express;
  const realtimeTarget =
    process.env['REALTIME_SERVICE_URL'] ?? 'http://localhost:8228';
  const socketIoProxy = createProxyMiddleware({
    target: realtimeTarget,
    changeOrigin: true,
    ws: true,
  });
  expressApp.use('/socket.io', socketIoProxy);

  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ limit: '2mb', extended: true }));
  const port = Number(process.env['API_GATEWAY_PORT']) || 4225;
  await app.listen(port);
  app.getHttpServer().on('upgrade', socketIoProxy.upgrade);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
