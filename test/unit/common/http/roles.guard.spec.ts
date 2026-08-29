import {
  ForbiddenException,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { RolesGuard } from '../../../../src/module/auth/guards/roles.guard';

describe('RolesGuard', () => {
  it('allows routes without role metadata', () => {
    const fixture = createFixture(undefined, undefined);

    expect(fixture.guard.canActivate(fixture.context)).toBe(true);
  });

  it('requires a user access token when role metadata exists', () => {
    const missing = createFixture(['ADMIN'], undefined);
    const customer = createFixture(['ADMIN'], { actor_type: 'customer' });

    expect(() => missing.guard.canActivate(missing.context)).toThrow(
      UnauthorizedException,
    );
    expect(() => customer.guard.canActivate(customer.context)).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a user without an id or role', () => {
    const missingId = createFixture(['ADMIN'], {
      actor_type: 'user',
      role: 'ADMIN',
    });
    const missingRole = createFixture(['ADMIN'], {
      actor_type: 'user',
      user_id: 'user-1',
    });

    expect(() => missingId.guard.canActivate(missingId.context)).toThrow(
      ForbiddenException,
    );
    expect(() => missingRole.guard.canActivate(missingRole.context)).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a role that is not in metadata', () => {
    const fixture = createFixture(['ADMIN'], {
      actor_type: 'user',
      user_id: 'user-1',
      role: 'STAFF',
    });

    expect(() => fixture.guard.canActivate(fixture.context)).toThrow(
      ForbiddenException,
    );
  });

  it('permits a user whose current request role is in metadata', () => {
    const fixture = createFixture(['ADMIN'], {
      actor_type: 'user',
      user_id: 'user-1',
      role: 'ADMIN',
    });

    expect(fixture.guard.canActivate(fixture.context)).toBe(true);
  });
});

function createFixture(
  roles: Array<'STAFF' | 'ADMIN'> | undefined,
  auth:
    | {
        actor_type: 'customer' | 'user';
        user_id?: string;
        role?: 'STAFF' | 'ADMIN';
      }
    | undefined,
): {
  guard: RolesGuard;
  context: ExecutionContext;
} {
  const reflector = {
    getAllAndOverride: jest.fn(() => roles),
  } as unknown as Reflector;
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ auth }),
    }),
  } as unknown as ExecutionContext;

  return {
    guard: new RolesGuard(reflector),
    context,
  };
}
