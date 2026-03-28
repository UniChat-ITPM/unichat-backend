import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class JwtBearerUserService {
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

  /** Returns JWT `sub` (user id) when `Authorization: Bearer <accessToken>` is valid. */
  verifyBearerUserId(authorizationHeader: string | undefined): string {
    const raw = Array.isArray(authorizationHeader)
      ? authorizationHeader[0]
      : authorizationHeader;
    if (typeof raw !== 'string' || !raw.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header (expected Bearer token)',
      );
    }
    const token = raw.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    try {
      const decoded = jwt.verify(token, this.getJwtSecret()) as {
        sub?: unknown;
      };
      const sub = decoded.sub;
      if (typeof sub !== 'string' || !UUID_RE.test(sub)) {
        throw new UnauthorizedException('Invalid access token subject');
      }
      return sub;
    } catch (e) {
      if (e instanceof UnauthorizedException) {
        throw e;
      }
      if (e instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedException('Access token expired');
      }
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
