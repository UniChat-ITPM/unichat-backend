import {
  Injectable,
  Logger,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** Express / JSON cannot encode `bigint` (Prisma BigInt columns). Safe for API bodies. */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === 'bigint') {
        return v.toString();
      }
      if (v instanceof Date) {
        return v.toISOString();
      }
      return v;
    }),
  ) as T;
}

@Injectable()
export class BigIntJsonInterceptor implements NestInterceptor {
  private readonly logger = new Logger(BigIntJsonInterceptor.name);

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        if (data === undefined) {
          return data;
        }
        try {
          return jsonSafe(data);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger.error(`Response serialization failed: ${msg}`);
          throw e;
        }
      }),
    );
  }
}
