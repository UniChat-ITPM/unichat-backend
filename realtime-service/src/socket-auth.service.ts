import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { Socket } from 'socket.io';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccessTokenPayload extends jwt.JwtPayload {
  sub: string;
}

@Injectable()
export class SocketAuthService {
  private getJwtSecret(): string {
    const secret = process.env['JWT_SECRET'];
    if (secret) {
      return secret;
    }
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('JWT_SECRET is required in production');
    }
    return 'unichat-dev-jwt-secret-change-me';
  }

  /** Resolves user id from JWT (auth.token / auth.accessToken / Authorization Bearer). */
  verifyUserIdFromHandshake(socket: Socket): string | null {
    const auth = socket.handshake.auth as Record<string, unknown>;
    const fromAuth =
      (typeof auth?.['token'] === 'string' ? auth['token'] : null) ??
      (typeof auth?.['accessToken'] === 'string'
        ? auth['accessToken']
        : null);

    const header = socket.handshake.headers['authorization'];
    const rawHeader = Array.isArray(header) ? header[0] : header;
    const fromBearer =
      typeof rawHeader === 'string' && rawHeader.startsWith('Bearer ')
        ? rawHeader.slice(7).trim()
        : null;

    const token = fromAuth ?? fromBearer;
    if (!token) {
      return null;
    }

    try {
      const decoded = jwt.verify(token, this.getJwtSecret()) as AccessTokenPayload;
      const sub = decoded.sub;
      if (typeof sub !== 'string' || !UUID_RE.test(sub)) {
        return null;
      }
      return sub;
    } catch {
      return null;
    }
  }
}
