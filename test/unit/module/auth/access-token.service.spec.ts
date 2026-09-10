import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'node:crypto';

import { AccessTokenService } from '../../../../src/module/auth/access-token.service';
import { AccessTokenClaimsValidator } from '../../../../src/module/auth/access-token-claims.validator';

describe('AccessTokenService', () => {
  const secret = 'unit-test-access-token-secret';
  let service: AccessTokenService;

  beforeEach(() => {
    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'JWT_ACCESS_TOKEN_SECRET') {
          return secret;
        }

        if (key === 'JWT_ACCESS_TOKEN_EXPIRES_IN') {
          return '15m';
        }

        throw new Error(`Unexpected config key: ${key}`);
      }),
    };

    service = new AccessTokenService(
      config as unknown as ConfigService,
      new AccessTokenClaimsValidator(),
      new JwtService(),
    );
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('signs and verifies a customer token with its revocation version', () => {
    const token = service.sign({
      actorType: 'customer',
      customerId: 'customer-1',
      tokenVersion: 3,
    });

    expect(service.verify(token)).toEqual({
      sub: 'customer:customer-1',
      actor_type: 'customer',
      customer_id: 'customer-1',
      token_version: 3,
      iat: 1_800_000_000,
      exp: 1_800_000_900,
    });
  });

  it('signs and verifies a user token with its role', () => {
    const token = service.sign({
      actorType: 'user',
      userId: 'user-1',
      role: 'ADMIN',
      tokenVersion: 2,
    });

    expect(service.verify(token)).toMatchObject({
      sub: 'user:user-1',
      actor_type: 'user',
      user_id: 'user-1',
      role: 'ADMIN',
      token_version: 2,
    });
  });

  it.each([
    {
      name: 'subject does not match the customer id',
      payload: {
        sub: 'customer:other',
        actor_type: 'customer',
        customer_id: 'customer-1',
        token_version: 0,
        iat: 1_800_000_000,
        exp: 1_800_000_900,
      },
    },
    {
      name: 'issued-at is in the future',
      payload: {
        sub: 'user:user-1',
        actor_type: 'user',
        user_id: 'user-1',
        token_version: 0,
        iat: 1_800_000_061,
        exp: 1_800_000_900,
      },
    },
    {
      name: 'expiration is not after issued-at',
      payload: {
        sub: 'user:user-1',
        actor_type: 'user',
        user_id: 'user-1',
        token_version: 0,
        iat: 1_800_000_000,
        exp: 1_800_000_000,
      },
    },
  ])('rejects a validly signed token when $name', ({ payload }) => {
    expect(() => service.verify(signPayload(payload, secret))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects expired and tampered tokens', () => {
    const expired = signPayload(
      {
        sub: 'customer:customer-1',
        actor_type: 'customer',
        customer_id: 'customer-1',
        token_version: 0,
        iat: 1_799_999_000,
        exp: 1_799_999_999,
      },
      secret,
    );
    const valid = service.sign({
      actorType: 'customer',
      customerId: 'customer-1',
      tokenVersion: 0,
    });

    expect(() => service.verify(expired)).toThrow('Access token has expired.');
    expect(() => service.verify(`${valid.slice(0, -1)}x`)).toThrow(
      'Invalid access token.',
    );
  });

  it.each([
    ['30s', 30],
    ['15m', 900],
    ['1h', 3600],
    ['7d', 604800],
    ['1', 1],
    [' 15m ', 900],
  ])('parses %s as %s seconds', (duration, expected) => {
    const config = {
      getOrThrow: jest.fn(() => duration),
    };
    const durationService = new AccessTokenService(
      config as unknown as ConfigService,
      new AccessTokenClaimsValidator(),
      new JwtService(),
    );

    expect(durationService.getExpiresInSeconds()).toBe(expected);
  });

  it.each(['0', '0s', '-1m', '1.5h', 'abc', '1w', '1ms', 'Infinity', 'NaN'])(
    'rejects invalid duration %s',
    (duration) => {
      const config = {
        getOrThrow: jest.fn(() => duration),
      };
      const invalidService = new AccessTokenService(
        config as unknown as ConfigService,
        new AccessTokenClaimsValidator(),
        new JwtService(),
      );

      expect(() => invalidService.getExpiresInSeconds()).toThrow(
        'JWT access token duration is invalid.',
      );
    },
  );

  it('rejects duration overflow instead of returning Infinity', () => {
    const config = {
      getOrThrow: jest.fn(() => `${'9'.repeat(400)}d`),
    };
    const invalidService = new AccessTokenService(
      config as unknown as ConfigService,
      new AccessTokenClaimsValidator(),
      new JwtService(),
    );

    expect(() => invalidService.getExpiresInSeconds()).toThrow(
      'JWT access token duration is invalid.',
    );
  });
});

function signPayload(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    'utf8',
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}
