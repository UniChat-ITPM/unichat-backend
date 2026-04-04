import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/** Best-effort per-process limits; use edge rate limiting in production for multi-instance deployments. */
@Injectable()
export class ContactMatchRateLimiterService {
  private readonly windowMs =
    Number(process.env['CONTACT_MATCH_RATE_WINDOW_MS'] ?? 60_000) || 60_000;
  private readonly maxPerUser =
    Number(process.env['CONTACT_MATCH_RATE_MAX'] ?? 30) || 30;
  private readonly maxPerIp =
    Number(process.env['CONTACT_MATCH_RATE_MAX_PER_IP'] ?? 120) || 120;
  private readonly hits = new Map<string, number[]>();

  /** Throws HTTP 429 when either the signed-in user or the client IP exceeded its quota. */
  assertWithinLimit(userId: string, clientIp: string): void {
    this.consume(`user:${userId}`, this.maxPerUser);
    this.consume(`ip:${clientIp}`, this.maxPerIp);
  }

  private consume(bucketKey: string, maxPerWindow: number): void {
    const now = Date.now();
    const prev = this.hits.get(bucketKey) ?? [];
    const windowStart = now - this.windowMs;
    const pruned = prev.filter((t) => t > windowStart);
    if (pruned.length >= maxPerWindow) {
      this.hits.set(bucketKey, pruned);
      throw new HttpException(
        'Too many contact match requests; try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    pruned.push(now);
    this.hits.set(bucketKey, pruned);
  }
}
