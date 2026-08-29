import { SetMetadata } from '@nestjs/common';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_KEY = 'rate-limit';

export function assertValidRateLimitOptions(
  options: unknown,
): asserts options is RateLimitOptions {
  if (options === null || typeof options !== 'object') {
    throw new Error('Rate limit options must be an object.');
  }

  const { limit, windowMs } = options as Partial<RateLimitOptions>;

  if (
    typeof limit !== 'number' ||
    !Number.isFinite(limit) ||
    !Number.isInteger(limit) ||
    limit <= 0
  ) {
    throw new Error('Rate limit limit must be a positive integer.');
  }

  if (
    typeof windowMs !== 'number' ||
    !Number.isFinite(windowMs) ||
    windowMs <= 0
  ) {
    throw new Error(
      'Rate limit windowMs must be a finite number greater than zero.',
    );
  }
}

export const RateLimit = (options: RateLimitOptions) => {
  assertValidRateLimitOptions(options);

  return SetMetadata(RATE_LIMIT_KEY, options);
};
