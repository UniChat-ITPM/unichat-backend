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

/** WebSocket proxy targets must be an origin only (no `/api`); prefer 127.0.0.1 over localhost on Windows. */
function socketProxyTarget(raw: string | undefined, fallback: string): string {
  let o = (raw ?? fallback).replace(/\/$/, '');
  if (o.endsWith('/api')) {
    o = o.slice(0, -'/api'.length);
  }
  if (/^http:\/\/localhost(?=:|\/|$)/i.test(o)) {
    o = o.replace(/^http:\/\/localhost/i, 'http://127.0.0.1');
  }
  if (/^https:\/\/localhost(?=:|\/|$)/i.test(o)) {
    o = o.replace(/^https:\/\/localhost/i, 'https://127.0.0.1');
  }
  return o;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env['CORS_ORIGIN']?.split(',') ?? true,
    credentials: true,
  });

  const expressApp = app.getHttpAdapter().getInstance() as express.Express;
  const realtimeTarget = socketProxyTarget(
    process.env['REALTIME_SERVICE_URL'],
    'http://localhost:8228',
  );
  const socketIoProxy = createProxyMiddleware({
    target: realtimeTarget,
    changeOrigin: true,
    ws: true,
  });
  expressApp.use('/socket.io', socketIoProxy);

  const callServiceTarget = socketProxyTarget(
    process.env['CALL_SERVICE_URL'],
    'http://localhost:8229',
  );
  const callSocketProxy = createProxyMiddleware({
    target: callServiceTarget,
    changeOrigin: true,
    ws: true,
  });
  expressApp.use('/call/socket.io', callSocketProxy);

  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  // Large enough for profilePhoto as base64 (API allows up to 5 MB raw image).
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));
  const port = Number(process.env['API_GATEWAY_PORT']) || 4225;
  await app.listen(port);
  const httpServer = app.getHttpServer();
  httpServer.on('upgrade', (req, socket, head) => {
    const path = req.url?.split('?')[0] ?? '';
    if (path.startsWith('/call/socket.io')) {
      callSocketProxy.upgrade?.(req, socket, head);
    } else if (path.startsWith('/socket.io')) {
      socketIoProxy.upgrade?.(req, socket, head);
    } else {
      socket.destroy();
    }
  });
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
