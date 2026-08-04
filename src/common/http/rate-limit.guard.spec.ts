import { type ExecutionContext, HttpException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { RateLimitGuard } from './rate-limit.guard';

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
