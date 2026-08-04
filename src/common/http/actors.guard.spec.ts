import {
  ForbiddenException,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { ActorsGuard } from './actors.guard';

describe('ActorsGuard', () => {
  it('allows routes without actor metadata', () => {
    const fixture = createFixture(undefined, undefined);

    expect(fixture.guard.canActivate(fixture.context)).toBe(true);
  });

  it('requires authentication when actor metadata exists', () => {
    const fixture = createFixture(['customer'], undefined);

    expect(() => fixture.guard.canActivate(fixture.context)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects the wrong actor and permits an allowed actor', () => {
    const rejected = createFixture(['user'], {
      actor_type: 'customer',
    });
    const allowed = createFixture(['customer'], {
      actor_type: 'customer',
    });

    expect(() => rejected.guard.canActivate(rejected.context)).toThrow(
      ForbiddenException,
    );
    expect(allowed.guard.canActivate(allowed.context)).toBe(true);
  });
});

function createFixture(
  actors: Array<'customer' | 'user'> | undefined,
  auth: { actor_type: 'customer' | 'user' } | undefined,
): { guard: ActorsGuard; context: ExecutionContext } {
  const reflector = {
    getAllAndOverride: jest.fn(() => actors),
  } as unknown as Reflector;
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ auth }),
    }),
  } as unknown as ExecutionContext;

  return { guard: new ActorsGuard(reflector), context };
}
