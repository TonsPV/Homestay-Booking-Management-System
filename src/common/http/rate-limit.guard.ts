import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

import { RATE_LIMIT_KEY, type RateLimitOptions } from './rate-limit.decorator';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private lastSweepAt = Date.now();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (options === undefined) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const now = Date.now();
    const key = [
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
      request.method,
      context.getClass().name,
      context.getHandler().name,
    ].join(':');
    const current = this.buckets.get(key);

    this.sweepExpiredBuckets(now, options.windowMs);

    if (current === undefined || current.resetAt <= now) {
      this.buckets.set(key, {
        count: 1,
        resetAt: now + options.windowMs,
      });
      return true;
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((current.resetAt - now) / 1000),
    );

    if (current.count >= options.limit) {
      response.setHeader('Retry-After', String(retryAfterSeconds));
      throw new HttpException(
        'Qua nhieu yeu cau. Vui long thu lai sau.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    current.count += 1;
    return true;
  }

  private sweepExpiredBuckets(now: number, windowMs: number): void {
    if (now - this.lastSweepAt < windowMs) {
      return;
    }

    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }

    this.lastSweepAt = now;
  }
}
