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
  'content-length',
  'accept',
  'accept-language',
] as const;

export type ProxiedBackend = 'conversation' | 'messaging' | 'realtime';

@Injectable()
export class BackendProxyService {
  private readonly logger = new Logger(BackendProxyService.name);

  /** Prefer 127.0.0.1 over localhost on Windows to reduce IPv6 (::1) / IPv4 mismatches. */
  private readonly origins: Record<ProxiedBackend, string> = {
    conversation:
      process.env['CONVERSATION_SERVICE_URL'] ?? 'http://127.0.0.1:4229',
    messaging:
      process.env['MESSAGING_SERVICE_URL'] ?? 'http://127.0.0.1:4230',
    realtime:
      process.env['REALTIME_SERVICE_URL'] ?? 'http://127.0.0.1:8228',
  };

  /**
   * `.env` often sets service URLs with an `/api` suffix (same as ApiService HTTP clients).
   * Proxy targets must be `origin + req.originalUrl`, and `originalUrl` already begins with
   * `/api/...` from the gateway global prefix — so a trailing `/api` on origin yields
   * `/api/api/...` on the downstream service (404).
   */
  private normalizeProxyOrigin(raw: string): string {
    let o = raw.replace(/\/$/, '');
    if (o.endsWith('/api')) {
      o = o.slice(0, -'/api'.length);
    }
    return o;
  }

  async forward(backend: ProxiedBackend, req: Request) {
    const origin = this.normalizeProxyOrigin(this.origins[backend]);
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
    const contentType = req.headers['content-type'];
    const ct = Array.isArray(contentType) ? contentType[0] : contentType;
    const isMultipart =
      typeof ct === 'string' && ct.toLowerCase().includes('multipart/form-data');

    // JSON/urlencoded bodies are on `req.body`. Multipart is never parsed here — forward the raw stream.
    const forwardBody: unknown = !hasBody
      ? undefined
      : isMultipart
        ? req
        : req.body;

    const ctLower = typeof ct === 'string' ? ct.toLowerCase() : '';
    const axiosWillJsonSerialize =
      !isMultipart &&
      hasBody &&
      forwardBody != null &&
      typeof forwardBody === 'object' &&
      !Buffer.isBuffer(forwardBody) &&
      (ctLower === '' ||
        ctLower.includes('json') ||
        ctLower.includes('application/graphql'));

    /*
     * Axios re-stringifies object bodies; forwarding the client Content-Length breaks the framing
     * (length mismatch → hung or reset connection, often surfacing as empty AxiosError messages).
     */
    if (axiosWillJsonSerialize) {
      delete headers['content-length'];
      delete headers['transfer-encoding'];
    }

    try {
      const response = await axios.request({
        method,
        url: targetUrl,
        headers,
        data: forwardBody,
        validateStatus: () => true,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: Number(process.env['GATEWAY_PROXY_TIMEOUT_MS'] ?? 120_000),
      });

      return {
        status: response.status,
        data: response.data,
      };
    } catch (error) {
      const detail = this.formatProxyTransportError(error, targetUrl);
      this.logger.error(`${backend} proxy failed for ${method} ${req.originalUrl}: ${detail}`);
      throw new ServiceUnavailableException(
        `Unable to reach ${backend} service`,
      );
    }
  }

  private formatProxyTransportError(error: unknown, targetUrl: string): string {
    if (error instanceof AxiosError) {
      const bits: string[] = [];
      const m = error.message?.trim();
      bits.push(m && m.length > 0 ? m : '(no axios message)');
      if (error.code) {
        bits.push(`code=${error.code}`);
      }
      if (error.response) {
        bits.push(`respStatus=${error.response.status}`);
      }
      if (error.cause instanceof Error && error.cause.message) {
        bits.push(`cause=${error.cause.message}`);
      }
      bits.push(`→ ${targetUrl}`);
      return bits.join(' ');
    }
    if (error instanceof Error) {
      return error.message?.trim() || error.name || String(error);
    }
    return String(error);
  }
}
