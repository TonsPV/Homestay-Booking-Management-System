import {
  ForbiddenException,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  it('allows routes without role metadata', async () => {
    const fixture = createFixture(undefined, undefined, null);

    await expect(fixture.guard.canActivate(fixture.context)).resolves.toBe(
      true,
    );
    expect(fixture.findById).not.toHaveBeenCalled();
  });

  it('requires a user access token when role metadata exists', async () => {
    const missing = createFixture(['ADMIN'], undefined, null);
    const customer = createFixture(['ADMIN'], { actor_type: 'customer' }, null);

    await expect(
      missing.guard.canActivate(missing.context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      customer.guard.canActivate(customer.context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects missing, locked and unauthorized users', async () => {
    const missing = createFixture(
      ['ADMIN'],
      { actor_type: 'user', user_id: 'user-1' },
      null,
    );
    const locked = createFixture(
      ['ADMIN'],
      { actor_type: 'user', user_id: 'user-1' },
      { role: 'ADMIN', status: 'LOCKED' },
    );
    const wrongRole = createFixture(
      ['ADMIN'],
      { actor_type: 'user', user_id: 'user-1' },
      { role: 'STAFF', status: 'ACTIVE' },
    );

    await expect(
      missing.guard.canActivate(missing.context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      locked.guard.canActivate(locked.context),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      wrongRole.guard.canActivate(wrongRole.context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reloads the current role and permits an authorized active user', async () => {
    const auth = { actor_type: 'user' as const, user_id: 'user-1' };
    const fixture = createFixture(['ADMIN'], auth, {
      role: 'ADMIN',
      status: 'ACTIVE',
    });

    await expect(fixture.guard.canActivate(fixture.context)).resolves.toBe(
      true,
    );
    expect(auth).toMatchObject({ role: 'ADMIN' });
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
  user: { role: 'STAFF' | 'ADMIN'; status: 'ACTIVE' | 'LOCKED' } | null,
): {
  guard: RolesGuard;
  context: ExecutionContext;
  findById: jest.Mock;
} {
  const reflector = {
    getAllAndOverride: jest.fn(() => roles),
  } as unknown as Reflector;
  const findById = jest.fn().mockResolvedValue(user);
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ auth }),
    }),
  } as unknown as ExecutionContext;

  return {
    guard: new RolesGuard(reflector, {
      findById,
    }),
    context,
    findById,
  };
}
