import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'node:crypto';

import { AccessTokenService } from '../../../../src/module/auth/access-token.service';
import { AccessTokenClaimsValidator } from '../../../../src/module/auth/access-token-claims.validator';
import type { AccessTokenPayload } from '../../../../src/module/auth/auth.types';

describe('AccessTokenService — characterization (frozen pre-Passport behavior)', () => {
  const secret = 'unit-test-access-token-secret';
  const nowSeconds = 1_800_000_000;
  let service: AccessTokenService;

  beforeEach(() => {
    service = createService(secret, '15m');
    jest.spyOn(Date, 'now').mockReturnValue(nowSeconds * 1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts a validly signed customer token and preserves only known claims', () => {
    const token = signPayload(
      {
        sub: 'customer:customer-1',
        actor_type: 'customer',
        customer_id: 'customer-1',
        token_version: 3,
        iat: nowSeconds,
        exp: nowSeconds + 900,
        nbf: nowSeconds + 60,
        jti: 'some-random-id',
      },
      secret,
    );

    // nbf and jti are unknown claims: current verifier ignores them (no nbf
    // enforcement) and drops them from the normalized payload.
    expect(service.verify(token)).toEqual({
      sub: 'customer:customer-1',
      actor_type: 'customer',
      customer_id: 'customer-1',
      token_version: 3,
      iat: nowSeconds,
      exp: nowSeconds + 900,
    });
  });

  it('accepts a validly signed user token with a role', () => {
    const token = signPayload(
      {
        sub: 'user:user-1',
        actor_type: 'user',
        user_id: 'user-1',
        role: 'STAFF',
        token_version: 1,
        iat: nowSeconds,
        exp: nowSeconds + 900,
      },
      secret,
    );

    expect(service.verify(token)).toEqual({
      sub: 'user:user-1',
      actor_type: 'user',
      user_id: 'user-1',
      role: 'STAFF',
      token_version: 1,
      iat: nowSeconds,
      exp: nowSeconds + 900,
    });
  });

  it('rejects a token whose signature does not match', () => {
    const token = signPayload(validCustomerPayload(), secret);

    expect(() => service.verify(`${token.slice(0, -1)}x`)).toThrow(
      new UnauthorizedException('Invalid access token.'),
    );
  });

  it('rejects a token signed with a different secret', () => {
    const token = signPayload(validCustomerPayload(), 'another-secret-value');

    expect(() => service.verify(token)).toThrow(
      new UnauthorizedException('Invalid access token.'),
    );
  });

  it.each(['none', 'HS512', 'HS384', 'RS256'] as const)(
    'rejects a token whose header alg is %s even when the signature is valid',
    (alg) => {
      const token = signPayload(validCustomerPayload(), secret, { alg });

      expect(() => service.verify(token)).toThrow(
        new UnauthorizedException('Invalid access token.'),
      );
    },
  );

  it('rejects a token whose header typ is not JWT', () => {
    const token = signPayload(validCustomerPayload(), secret, {
      alg: 'HS256',
      typ: 'JWS',
    });

    expect(() => service.verify(token)).toThrow(
      new UnauthorizedException('Invalid access token.'),
    );
  });

  it('rejects a token with a missing header typ', () => {
    const token = signPayload(validCustomerPayload(), secret, {
      alg: 'HS256',
      typ: undefined,
    });

    expect(() => service.verify(token)).toThrow(
      new UnauthorizedException('Invalid access token.'),
    );
  });

  it.each([
    ['two segments', 'a.b'],
    ['four segments', 'a.b.c.d'],
    ['one segment', 'abcdef'],
    ['empty string', ''],
  ])('rejects a malformed token: %s', (_name, token) => {
    expect(() => service.verify(token)).toThrow(
      new UnauthorizedException('Invalid access token.'),
    );
  });

  it('rejects a token with undecodable base64url payload', () => {
    // "%" is not valid base64url content.
    const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
    const signature = signSegments(header, '%', secret);

    expect(() => service.verify(`${header}.%.${signature}`)).toThrow(
      new UnauthorizedException('Invalid access token.'),
    );
  });

  it('rejects a token whose payload is a JSON primitive instead of an object', () => {
    const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
    const body = encodeJson('hello');
    const signature = signSegments(header, body, secret);

    expect(() => service.verify(`${header}.${body}.${signature}`)).toThrow(
      new UnauthorizedException('Invalid access token.'),
    );
  });

  it('rejects a token whose payload is a JSON array', () => {
    const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
    const body = encodeJson([1, 2, 3]);
    const signature = signSegments(header, body, secret);

    expect(() => service.verify(`${header}.${body}.${signature}`)).toThrow(
      new UnauthorizedException('Invalid access token.'),
    );
  });

  it('rejects a token whose payload is invalid JSON', () => {
    const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
    const signature = signSegments(header, '{not-json', secret);

    expect(() => service.verify(`${header}.{not-json.${signature}`)).toThrow(
      new UnauthorizedException('Invalid access token.'),
    );
  });

  it('rejects a token with missing iat', () => {
    const payload = validCustomerPayload();
    delete payload.iat;

    expect(() => verifySigned(payload)).toThrow(
      new UnauthorizedException('Invalid access token.'),
    );
  });

  it.each([1800000000.5, Number.NaN, '1800000000'])(
    'rejects a non-integer iat: %p',
    (iat) => {
      expect(() => verifySigned({ ...validCustomerPayload(), iat })).toThrow(
        new UnauthorizedException('Invalid access token.'),
      );
    },
  );

  it('accepts iat exactly 60 seconds in the future (clock-skew boundary)', () => {
    const payload = {
      ...validCustomerPayload(),
      iat: nowSeconds + 60,
      exp: nowSeconds + 900,
    };

    expect(() => verifySigned(payload)).not.toThrow();
  });

  it('rejects iat 61 seconds in the future', () => {
    const payload = {
      ...validCustomerPayload(),
      iat: nowSeconds + 61,
      exp: nowSeconds + 900,
    };

    expect(() => verifySigned(payload)).toThrow(
      new UnauthorizedException('Invalid access token.'),
    );
  });

  it('rejects a token with missing exp', () => {
    const payload = validCustomerPayload();
    delete payload.exp;

    expect(() => verifySigned(payload)).toThrow(
      new UnauthorizedException('Invalid access token.'),
    );
  });

  it('rejects a non-integer exp', () => {
    expect(() =>
      verifySigned({ ...validCustomerPayload(), exp: 1800000900.5 }),
    ).toThrow(new UnauthorizedException('Invalid access token.'));
  });

  it('rejects exp equal to iat', () => {
    expect(() =>
      verifySigned({
        ...validCustomerPayload(),
        exp: nowSeconds,
      }),
    ).toThrow(new UnauthorizedException('Invalid access token.'));
  });

  it('rejects exp below iat', () => {
    expect(() =>
      verifySigned({
        ...validCustomerPayload(),
        exp: nowSeconds - 1,
      }),
    ).toThrow(new UnauthorizedException('Invalid access token.'));
  });

  it('rejects an expired token with the dedicated expired message', () => {
    const payload = {
      ...validCustomerPayload(),
      iat: nowSeconds - 900,
      exp: nowSeconds - 1,
    };

    expect(() => verifySigned(payload)).toThrow(
      new UnauthorizedException('Access token has expired.'),
    );
  });

  it('rejects exp exactly equal to now with the expired message', () => {
    const payload = {
      ...validCustomerPayload(),
      iat: nowSeconds - 100,
      exp: nowSeconds,
    };

    expect(() => verifySigned(payload)).toThrow(
      new UnauthorizedException('Access token has expired.'),
    );
  });

  it('accepts exp exactly one second above now', () => {
    const payload = {
      ...validCustomerPayload(),
      exp: nowSeconds + 1,
    };

    expect(() => verifySigned(payload)).not.toThrow();
  });

  it.each(['admin', 'system', 'CUSTOMER', 'USER', 42, null, undefined])(
    'rejects an invalid actor_type: %p',
    (actor_type) => {
      const base = validCustomerPayload();
      delete base.customer_id;
      expect(() =>
        verifySigned({
          ...base,
          actor_type,
          user_id: 'user-1',
        }),
      ).toThrow(new UnauthorizedException('Invalid access token.'));
    },
  );

  it('rejects an empty customer id', () => {
    expect(() =>
      verifySigned({ ...validCustomerPayload(), customer_id: '' }),
    ).toThrow(new UnauthorizedException('Invalid access token.'));
  });

  it('rejects a non-string customer id', () => {
    expect(() =>
      verifySigned({ ...validCustomerPayload(), customer_id: 123 }),
    ).toThrow(new UnauthorizedException('Invalid access token.'));
  });

  it('rejects a missing customer id for a customer token', () => {
    const payload = validCustomerPayload();
    delete payload.customer_id;

    expect(() => verifySigned(payload)).toThrow(
      new UnauthorizedException('Invalid access token.'),
    );
  });

  it('rejects a missing user id for a user token', () => {
    const payload = validUserPayload();
    delete payload.user_id;

    expect(() => verifySigned(payload)).toThrow(
      new UnauthorizedException('Invalid access token.'),
    );
  });

  it.each([
    ['user-prefixed sub on a customer token', 'user:customer-1', 'customer'],
    ['customer-prefixed sub on a user token', 'customer:user-1', 'user'],
    ['mismatched customer id', 'customer:other', 'customer'],
    ['mismatched user id', 'user:other', 'user'],
  ])('rejects a token with %s', (_name, sub, actor) => {
    const payload =
      actor === 'customer'
        ? { ...validCustomerPayload(), sub }
        : { ...validUserPayload(), sub };

    expect(() => verifySigned(payload)).toThrow(
      new UnauthorizedException('Invalid access token.'),
    );
  });

  it('rejects a user token with a missing token_version', () => {
    const payload = validUserPayload();
    delete payload.token_version;

    expect(() => verifySigned(payload)).toThrow(
      new UnauthorizedException('Invalid access token.'),
    );
  });

  it.each([-1, -100, 1.5, Number.NaN, '3', null])(
    'rejects an invalid token_version: %p',
    (token_version) => {
      expect(() =>
        verifySigned({ ...validCustomerPayload(), token_version }),
      ).toThrow(new UnauthorizedException('Invalid access token.'));
    },
  );

  it('accepts token_version zero', () => {
    expect(() =>
      verifySigned({ ...validCustomerPayload(), token_version: 0 }),
    ).not.toThrow();
  });

  describe('library interoperability (custom HMAC <-> @nestjs/jwt)', () => {
    it('verifies a token forged with the reference custom HMAC implementation', () => {
      const forged = signPayload(validCustomerPayload(), secret);

      expect(service.verify(forged)).toEqual({
        sub: 'customer:customer-1',
        actor_type: 'customer',
        customer_id: 'customer-1',
        token_version: 2,
        iat: nowSeconds,
        exp: nowSeconds + 900,
      });
    });

    it('produces tokens verifiable by the reference custom HMAC implementation', () => {
      const token = service.sign({
        actorType: 'customer',
        customerId: 'customer-1',
        tokenVersion: 2,
      });

      // Old/reference verifier path: custom HMAC over the same segments.
      expect(() => verifyWithReferenceVerifier(token, secret)).not.toThrow();
      expect(verifyWithReferenceVerifier(token, secret)).toMatchObject({
        sub: 'customer:customer-1',
        actor_type: 'customer',
        customer_id: 'customer-1',
        token_version: 2,
      });
    });

    it('keeps the JWT header exactly alg HS256 and typ JWT', () => {
      const token = service.sign({
        actorType: 'user',
        userId: 'user-1',
        role: 'STAFF',
        tokenVersion: 1,
      });

      const header = JSON.parse(
        Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
      ) as { alg: string; typ: string };

      expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    });

    it('still verifies a legacy token that carries a future nbf claim', () => {
      const legacy = signPayload(
        {
          ...validCustomerPayload(),
          nbf: nowSeconds + 3_600,
        },
        secret,
      );

      expect(() => service.verify(legacy)).not.toThrow();
    });

    it('maps a signature failure from the library to the frozen message', () => {
      const token = signPayload(validCustomerPayload(), 'a-different-secret');

      expect(() => service.verify(token)).toThrow(
        new UnauthorizedException('Invalid access token.'),
      );
    });
  });

  it.each(['OWNER', 'MANAGER', 'staff', 'admin', 7])(
    'rejects an invalid JWT role: %p',
    (role) => {
      expect(() => verifySigned({ ...validUserPayload(), role })).toThrow(
        new UnauthorizedException('Invalid access token.'),
      );
    },
  );

  it('accepts a user token without a role claim (optional)', () => {
    const payload = validUserPayload();
    delete payload.role;

    expect(() => verifySigned(payload)).not.toThrow();
  });

  function createService(configuredSecret: string, expiresIn: string) {
    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'JWT_ACCESS_TOKEN_SECRET') {
          return configuredSecret;
        }

        if (key === 'JWT_ACCESS_TOKEN_EXPIRES_IN') {
          return expiresIn;
        }

        throw new Error(`Unexpected config key: ${key}`);
      }),
    };

    return new AccessTokenService(
      config as unknown as ConfigService,
      new AccessTokenClaimsValidator(),
      new JwtService(),
    );
  }

  function validCustomerPayload(): Record<string, unknown> {
    return {
      sub: 'customer:customer-1',
      actor_type: 'customer',
      customer_id: 'customer-1',
      token_version: 2,
      iat: nowSeconds,
      exp: nowSeconds + 900,
    };
  }

  function validUserPayload(): Record<string, unknown> {
    return {
      sub: 'user:user-1',
      actor_type: 'user',
      user_id: 'user-1',
      role: 'STAFF',
      token_version: 4,
      iat: nowSeconds,
      exp: nowSeconds + 900,
    };
  }

  function verifySigned(payload: Record<string, unknown>): AccessTokenPayload {
    return service.verify(
      signPayload(payload, secret, { alg: 'HS256', typ: 'JWT' }),
    );
  }
});

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signSegments(
  encodedHeader: string,
  encodedPayload: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
}

function signPayload(
  payload: Record<string, unknown>,
  secret: string,
  header: { alg: string; typ?: string } = { alg: 'HS256', typ: 'JWT' },
): string {
  const encodedHeader = encodeJson(header);
  const encodedPayload = encodeJson(payload);
  const signature = signSegments(encodedHeader, encodedPayload, secret);

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Reference implementation of the pre-migration custom verifier (HMAC-SHA256
 * over the base64url segments). Used to prove old tokens remain verifiable by
 * the new implementation and vice versa.
 */
function verifyWithReferenceVerifier(
  token: string,
  secret: string,
): Record<string, unknown> {
  const segments = token.split('.');

  if (segments.length !== 3) {
    throw new Error('malformed');
  }

  const [encodedHeader, encodedPayload, signature] = segments;
  const expectedSignature = signSegments(encodedHeader, encodedPayload, secret);

  if (signature !== expectedSignature) {
    throw new Error('signature mismatch');
  }

  return JSON.parse(
    Buffer.from(encodedPayload, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}
