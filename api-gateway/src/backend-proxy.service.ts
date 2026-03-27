import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import axios, { AxiosError, Method } from 'axios';

const HEADERS_TO_FORWARD = [
  'x-user-id',
  'authorization',
  'content-type',
  'accept',
  'accept-language',
] as const;

export type ProxiedBackend = 'conversation' | 'messaging' | 'realtime';

@Injectable()
export class BackendProxyService {
  private readonly logger = new Logger(BackendProxyService.name);

  private readonly origins: Record<ProxiedBackend, string> = {
    conversation:
      process.env['CONVERSATION_SERVICE_URL'] ?? 'http://localhost:4229',
    messaging:
      process.env['MESSAGING_SERVICE_URL'] ?? 'http://localhost:4230',
    realtime:
      process.env['REALTIME_SERVICE_URL'] ?? 'http://localhost:8228',
  };

  async forward(backend: ProxiedBackend, req: Request) {
    const origin = this.origins[backend].replace(/\/$/, '');
    const targetUrl = origin + req.originalUrl;

    const headers: Record<string, string> = {};
    for (const name of HEADERS_TO_FORWARD) {
      const v = req.headers[name];
      if (typeof v === 'string') {
        headers[name] = v;
      } else if (Array.isArray(v) && v[0]) {
        headers[name] = v[0];
      }
    }

    const method = req.method.toUpperCase() as Method;
    const hasBody = !['GET', 'HEAD'].includes(method);

    try {
      const response = await axios.request({
        method,
        url: targetUrl,
        headers,
        data: hasBody ? req.body : undefined,
        validateStatus: () => true,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      return {
        status: response.status,
        data: response.data,
      };
    } catch (error) {
      const msg =
        error instanceof AxiosError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Unknown error';
      this.logger.error(
        `${backend} proxy failed for ${method} ${req.originalUrl}: ${msg}`,
      );
      throw new ServiceUnavailableException(
        `Unable to reach ${backend} service`,
      );
    }
  }
}
