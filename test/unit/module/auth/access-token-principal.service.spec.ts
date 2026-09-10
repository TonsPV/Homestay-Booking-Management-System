import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { AccessTokenPrincipalService } from '../../../../src/module/auth/access-token-principal.service';
import type { AccessTokenPayload } from '../../../../src/module/auth/auth.types';
import type { CustomerAuthorizationState } from '../../../../src/module/auth/authorization/customer-authorization-reader';
import type { UserAuthorizationState } from '../../../../src/module/auth/authorization/user-authorization-reader';

describe('AccessTokenPrincipalService', () => {
  let findByIdCustomer: jest.Mock;
  let findByIdUser: jest.Mock;
  let service: AccessTokenPrincipalService;

  beforeEach(() => {
    findByIdCustomer = jest.fn();
    findByIdUser = jest.fn();
    service = new AccessTokenPrincipalService(
      { findById: findByIdUser },
      { findById: findByIdCustomer },
    );
  });

  describe('customer principal', () => {
    const payload: AccessTokenPayload = {
      sub: 'customer:customer-1',
      actor_type: 'customer',
      customer_id: 'customer-1',
      token_version: 2,
      iat: 100,
      exp: 200,
    };

    it('resolves an ACTIVE customer with a matching token version', async () => {
      findByIdCustomer.mockResolvedValue({
        id: 'customer-1',
        status: 'ACTIVE',
        tokenVersion: 2,
      } satisfies CustomerAuthorizationState);

      await expect(service.resolve(payload)).resolves.toEqual({
        actorType: 'customer',
        sub: 'customer:customer-1',
        customerId: 'customer-1',
        tokenVersion: 2,
        iat: 100,
        exp: 200,
      });
      expect(findByIdCustomer).toHaveBeenCalledWith('customer-1');
      expect(findByIdUser).not.toHaveBeenCalled();
    });

    it('rejects a missing customer account with 401', async () => {
      findByIdCustomer.mockResolvedValue(null);

      await expect(service.resolve(payload)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a token version mismatch with 401', async () => {
      findByIdCustomer.mockResolvedValue({
        id: 'customer-1',
        status: 'ACTIVE',
        tokenVersion: 3,
      } satisfies CustomerAuthorizationState);

      await expect(service.resolve(payload)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a LOCKED customer with 403', async () => {
      findByIdCustomer.mockResolvedValue({
        id: 'customer-1',
        status: 'LOCKED',
        tokenVersion: 2,
      } satisfies CustomerAuthorizationState);

      await expect(service.resolve(payload)).rejects.toMatchObject({
        constructor: ForbiddenException,
        message: 'Tai khoan bi khoa.',
      });
    });
  });

  describe('user principal', () => {
    const payload: AccessTokenPayload = {
      sub: 'user:user-1',
      actor_type: 'user',
      user_id: 'user-1',
      role: 'STAFF',
      token_version: 4,
      iat: 100,
      exp: 200,
    };

    it('resolves an ACTIVE user and refreshes the role from the database', async () => {
      findByIdUser.mockResolvedValue({
        id: 'user-1',
        role: 'ADMIN',
        status: 'ACTIVE',
        tokenVersion: 4,
      } satisfies UserAuthorizationState);

      await expect(service.resolve(payload)).resolves.toEqual({
        actorType: 'user',
        sub: 'user:user-1',
        userId: 'user-1',
        tokenVersion: 4,
        role: 'ADMIN',
        iat: 100,
        exp: 200,
      });
      expect(findByIdUser).toHaveBeenCalledWith('user-1');
      expect(findByIdCustomer).not.toHaveBeenCalled();
    });

    it('carries the database role even when it differs from the JWT role', async () => {
      findByIdUser.mockResolvedValue({
        id: 'user-1',
        role: 'ADMIN',
        status: 'ACTIVE',
        tokenVersion: 4,
      } satisfies UserAuthorizationState);

      const principal = await service.resolve({
        ...payload,
        role: 'STAFF',
      });

      expect(principal).toMatchObject({ role: 'ADMIN' });
    });

    it('rejects a missing user account with 401', async () => {
      findByIdUser.mockResolvedValue(null);

      await expect(service.resolve(payload)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a token version mismatch with 401', async () => {
      findByIdUser.mockResolvedValue({
        id: 'user-1',
        role: 'STAFF',
        status: 'ACTIVE',
        tokenVersion: 5,
      } satisfies UserAuthorizationState);

      await expect(service.resolve(payload)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a LOCKED user with 403', async () => {
      findByIdUser.mockResolvedValue({
        id: 'user-1',
        role: 'ADMIN',
        status: 'LOCKED',
        tokenVersion: 4,
      } satisfies UserAuthorizationState);

      await expect(service.resolve(payload)).rejects.toMatchObject({
        constructor: ForbiddenException,
        message: 'Tai khoan bi khoa.',
      });
    });
  });

  it('bubbles an unexpected database error', async () => {
    findByIdUser.mockRejectedValue(new Error('db connection lost'));

    await expect(
      service.resolve({
        sub: 'user:user-1',
        actor_type: 'user',
        user_id: 'user-1',
        token_version: 4,
        iat: 100,
        exp: 200,
      }),
    ).rejects.toThrow('db connection lost');
  });
});
