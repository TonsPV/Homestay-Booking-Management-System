import {
  ForbiddenException,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

import type {
  AccessTokenPayload,
  AuthenticatedRequest,
} from '../../common/http';
import { AccessTokenGuard } from './access-token.guard';
import type { AccessTokenService } from './access-token.service';

describe('AccessTokenGuard', () => {
  const customerPayload: AccessTokenPayload = {
    sub: 'customer:customer-1',
    actor_type: 'customer',
    customer_id: 'customer-1',
    token_version: 2,
    iat: 100,
    exp: 200,
  };
  const userPayload: AccessTokenPayload = {
    sub: 'user:user-1',
    actor_type: 'user',
    user_id: 'user-1',
    role: 'STAFF',
    token_version: 4,
    iat: 100,
    exp: 200,
  };

  let verify: jest.MockedFunction<(token: string) => AccessTokenPayload>;
  let findUserById: jest.Mock;
  let findCustomerById: jest.Mock;
  let guard: AccessTokenGuard;

  beforeEach(() => {
    verify = jest.fn<(token: string) => AccessTokenPayload>();
    findUserById = jest.fn();
    findCustomerById = jest.fn();
    guard = new AccessTokenGuard(
      { verify } as unknown as AccessTokenService,
      { findById: findUserById },
      {
        findById: findCustomerById,
      },
    );
  });

  it.each([
    undefined,
    '',
    'Basic token',
    'Bearer',
    'Bearer ',
    'Bearer valid-token trailing-data',
    ' Bearer valid-token',
  ])('rejects a malformed Authorization header: %s', async (authorization) => {
    const { context } = createContext(authorization);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it('checks the current customer tokenVersion before attaching auth', async () => {
    verify.mockReturnValue({ ...customerPayload });
    findCustomerById.mockResolvedValue({
      id: 'customer-1',
      status: 'ACTIVE',
      tokenVersion: 3,
    });
    const { context, request } = createContext('Bearer valid-token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findCustomerById).toHaveBeenCalledWith('customer-1');
    expect(request.auth).toBeUndefined();
  });

  it('rejects a locked customer even when the token version matches', async () => {
    verify.mockReturnValue({ ...customerPayload });
    findCustomerById.mockResolvedValue({
      id: 'customer-1',
      status: 'LOCKED',
      tokenVersion: 2,
    });
    const { context } = createContext('Bearer valid-token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refreshes the user role from DB and attaches verified auth', async () => {
    verify.mockReturnValue({ ...userPayload });
    findUserById.mockResolvedValue({
      id: 'user-1',
      role: 'ADMIN',
      status: 'ACTIVE',
      tokenVersion: 4,
    });
    const { context, request } = createContext('Bearer valid-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('valid-token');
    expect(request.auth).toEqual({
      ...userPayload,
      role: 'ADMIN',
    });
  });

  it('rejects a missing user account', async () => {
    verify.mockReturnValue({ ...userPayload });
    findUserById.mockResolvedValue(null);
    const { context } = createContext('Bearer valid-token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

function createContext(authorization: string | undefined): {
  context: ExecutionContext;
  request: Partial<AuthenticatedRequest> & {
    headers: { authorization?: string };
  };
} {
  const request: Partial<AuthenticatedRequest> & {
    headers: { authorization?: string };
  } = {
    headers:
      authorization === undefined ? {} : { authorization: authorization },
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  return { context, request };
}
