import { type ExecutionContext, HttpException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { RateLimit } from '../../../../src/common/http/rate-limit.decorator';
import { RateLimitGuard } from '../../../../src/common/http/rate-limit.guard';

describe('RateLimitGuard', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('does nothing when no rate-limit metadata exists', () => {
    const fixture = createFixture(undefined);

    expect(fixture.guard.canActivate(fixture.context)).toBe(true);
  });

  it('returns 429 and Retry-After after the configured limit', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-29T00:00:00.000Z'));
    const fixture = createFixture({ limit: 2, windowMs: 60_000 });

    expect(fixture.guard.canActivate(fixture.context)).toBe(true);
    expect(fixture.guard.canActivate(fixture.context)).toBe(true);

    try {
      fixture.guard.canActivate(fixture.context);
      throw new Error('Expected rate limit rejection.');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
    }

    expect(fixture.setHeader).toHaveBeenCalledWith('Retry-After', '60');
  });

  it('opens a fresh bucket after the window expires', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-29T00:00:00.000Z'));
    const fixture = createFixture({ limit: 1, windowMs: 1_000 });

    expect(fixture.guard.canActivate(fixture.context)).toBe(true);
    jest.setSystemTime(new Date('2026-07-29T00:00:01.001Z'));
    expect(fixture.guard.canActivate(fixture.context)).toBe(true);
  });

  it.each([
    ['zero limit', { limit: 0, windowMs: 1_000 }],
    ['negative limit', { limit: -1, windowMs: 1_000 }],
    ['NaN limit', { limit: Number.NaN, windowMs: 1_000 }],
    ['infinite limit', { limit: Number.POSITIVE_INFINITY, windowMs: 1_000 }],
    ['fractional limit', { limit: 1.5, windowMs: 1_000 }],
    ['zero window', { limit: 1, windowMs: 0 }],
    ['negative window', { limit: 1, windowMs: -1 }],
    ['NaN window', { limit: 1, windowMs: Number.NaN }],
    ['infinite window', { limit: 1, windowMs: Number.POSITIVE_INFINITY }],
  ])('rejects %s options before using a bucket', (_name, options) => {
    expect(() => RateLimit(options)).toThrow();

    const fixture = createFixture(options);

    expect(() => fixture.guard.canActivate(fixture.context)).toThrow();
    expect(fixture.setHeader).not.toHaveBeenCalled();
  });

  it('keeps buckets in the in-memory guard instance', () => {
    const first = createFixture({ limit: 1, windowMs: 60_000 });

    expect(first.guard.canActivate(first.context)).toBe(true);
    expect(() => first.guard.canActivate(first.context)).toThrow(HttpException);

    const second = createFixture({ limit: 1, windowMs: 60_000 });

    expect(second.guard.canActivate(second.context)).toBe(true);
  });
});

function createFixture(
  options: { limit: number; windowMs: number } | undefined,
): {
  guard: RateLimitGuard;
  context: ExecutionContext;
  setHeader: jest.Mock;
} {
  const reflector = {
    getAllAndOverride: jest.fn(() => options),
  } as unknown as Reflector;
  const setHeader = jest.fn();
  class TestController {
    route(): void {}
  }
  const route = Object.getOwnPropertyDescriptor(
    TestController.prototype,
    'route',
  )?.value as () => void;
  const context = {
    getHandler: () => route,
    getClass: () => TestController,
    switchToHttp: () => ({
      getRequest: () => ({
        ip: '127.0.0.1',
        method: 'POST',
        socket: {},
      }),
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;

  return {
    guard: new RateLimitGuard(reflector),
    context,
    setHeader,
  };
}
