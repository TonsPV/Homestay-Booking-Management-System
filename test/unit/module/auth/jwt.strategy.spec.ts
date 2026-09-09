import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { AccessTokenClaimsValidator } from '../../../../src/module/auth/access-token-claims.validator';
import type { AccessTokenPayload } from '../../../../src/module/auth/auth.types';
import { AccessTokenPrincipalService } from '../../../../src/module/auth/access-token-principal.service';
import type { AuthenticatedPrincipal } from '../../../../src/module/auth/authenticated-principal';
import { JwtStrategy } from '../../../../src/module/auth/strategies/jwt.strategy';

describe('JwtStrategy', () => {
  const secret = 'unit-test-access-token-secret';
  const nowSeconds = 1_800_000_000;

  let resolve: jest.MockedFunction<
    (payload: AccessTokenPayload) => Promise<AuthenticatedPrincipal>
  >;
  let strategy: JwtStrategy;
  let jwtService: JwtService;

  beforeEach(() => {
    resolve = jest.fn<Promise<AuthenticatedPrincipal>, [AccessTokenPayload]>();
    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'JWT_ACCESS_TOKEN_SECRET') {
          return secret;
        }

        throw new Error(`Unexpected config key: ${key}`);
      }),
    };
    strategy = new JwtStrategy(
      config as unknown as ConfigService,
      new AccessTokenClaimsValidator(),
      { resolve } as unknown as AccessTokenPrincipalService,
    );
    jwtService = new JwtService();
    jest.spyOn(Date, 'now').mockReturnValue(nowSeconds * 1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('complete decoded JWT shape (characterization)', () => {
    it('receives { header, payload, signature } and resolves the principal', async () => {
      const principal = {
        actorType: 'customer' as const,
        sub: 'customer:customer-1',
        customerId: 'customer-1',
        tokenVersion: 2,
        iat: nowSeconds,
        exp: nowSeconds + 900,
      };
      resolve.mockResolvedValue(principal);

      const token = jwtService.sign(
        {
          sub: 'customer:customer-1',
          actor_type: 'customer',
          customer_id: 'customer-1',
          token_version: 2,
          iat: nowSeconds,
          exp: nowSeconds + 900,
        },
        { secret },
      );

      const result = await strategy.validate(decodeComplete(token, secret));

      expect(result).toEqual(principal);
      const payloadArgument = resolve.mock.calls[0][0];
      expect(payloadArgument).toEqual({
        sub: 'customer:customer-1',
        actor_type: 'customer',
        customer_id: 'customer-1',
        token_version: 2,
        iat: nowSeconds,
        exp: nowSeconds + 900,
      });
    });

    it('rejects a wrong typ header even with a valid signature', async () => {
      const token = forgeToken({ typ: 'JWS' }, validCustomerClaims());

      await expect(
        strategy.validate(decodeComplete(token, secret)),
      ).rejects.toThrow(new UnauthorizedException('Invalid access token.'));
      expect(resolve).not.toHaveBeenCalled();
    });

    it('rejects a wrong alg header even when signed with HS512 key material', async () => {
      const token = forgeToken(
        { alg: 'HS512', typ: 'JWT' },
        validCustomerClaims(),
      );

      await expect(
        strategy.validate(decodeComplete(token, secret)),
      ).rejects.toThrow(new UnauthorizedException('Invalid access token.'));
    });

    it('rejects an unexpected validate() argument shape', async () => {
      // passport-jwt with complete:true always passes {header,payload,signature};
      // a bare payload must not be silently accepted.
      await expect(strategy.validate(validCustomerClaims())).rejects.toThrow(
        new UnauthorizedException('Invalid access token.'),
      );
      await expect(strategy.validate(null)).rejects.toThrow(
        new UnauthorizedException('Invalid access token.'),
      );
    });
  });

  describe('error mapping', () => {
    it('propagates the principal service 401 (revoked token)', async () => {
      resolve.mockRejectedValue(
        new UnauthorizedException('Invalid access token.'),
      );
      const token = jwtService.sign(validCustomerClaims(), { secret });

      await expect(
        strategy.validate(decodeComplete(token, secret)),
      ).rejects.toThrow(new UnauthorizedException('Invalid access token.'));
    });

    it('propagates the principal service 403 (locked account)', async () => {
      resolve.mockRejectedValue(new ForbiddenException('Tai khoan bi khoa.'));
      const token = jwtService.sign(validCustomerClaims(), { secret });

      await expect(
        strategy.validate(decodeComplete(token, secret)),
      ).rejects.toThrow(new ForbiddenException('Tai khoan bi khoa.'));
    });

    it('lets unexpected service errors bubble (no 401 masking)', async () => {
      resolve.mockRejectedValue(new Error('db down'));
      const token = jwtService.sign(validCustomerClaims(), { secret });

      await expect(
        strategy.validate(decodeComplete(token, secret)),
      ).rejects.toThrow('db down');
    });
  });

  describe('passport-level verification', () => {
    it('exposes the strategy under the "jwt" name with HS256 config', () => {
      expect(strategy.name).toBe('jwt');
    });

    function authenticate(
      authorization: string | undefined,
    ): Promise<{ user?: unknown; error?: unknown; challenge?: unknown }> {
      return new Promise((resolvePromise) => {
        const request = {
          headers: authorization === undefined ? {} : { authorization },
        };
        const strategyWithStubs = Object.create(strategy) as {
          success: (user: unknown) => void;
          fail: (challenge: unknown) => void;
          error: (error: unknown) => void;
          authenticate: (request: unknown) => void;
        };
        strategyWithStubs.success = (user) => resolvePromise({ user });
        strategyWithStubs.fail = (challenge) => resolvePromise({ challenge });
        strategyWithStubs.error = (error) => resolvePromise({ error });

        strategyWithStubs.authenticate(request);
      });
    }

    it('authenticates a valid request through passport.authenticate flow', async () => {
      const principal = {
        actorType: 'customer' as const,
        sub: 'customer:customer-1',
        customerId: 'customer-1',
        tokenVersion: 2,
        iat: nowSeconds,
        exp: nowSeconds + 900,
      };
      resolve.mockResolvedValue(principal);
      const token = jwtService.sign(validCustomerClaims(), { secret });

      const result = await authenticate(`Bearer ${token}`);

      expect(result.user).toEqual(principal);
    });

    it('fails with the strict bearer challenge for a missing token', async () => {
      const result = await authenticate(undefined);

      expect(result.user).toBeUndefined();
      expect(String(result.challenge)).toContain('No auth token');
    });

    it('fails for a token signed with the wrong secret', async () => {
      const token = jwtService.sign(validCustomerClaims(), {
        secret: 'another-secret-value',
      });

      const result = await authenticate(`Bearer ${token}`);

      // passport-jwt routes jwt.verify errors through fail(challenge), and
      // passport surfaces the first challenge to the guard callback.
      expect(result.user).toBeUndefined();
      expect(result.error).toBeUndefined();
      expect(String(result.challenge).toLowerCase()).toContain('signature');
    });
  });

  function validCustomerClaims(): Record<string, unknown> {
    return {
      sub: 'customer:customer-1',
      actor_type: 'customer',
      customer_id: 'customer-1',
      token_version: 2,
      iat: nowSeconds,
      exp: nowSeconds + 900,
    };
  }

  function forgeToken(
    header: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): string {
    const encodedHeader = Buffer.from(JSON.stringify(header), 'utf8').toString(
      'base64url',
    );
    const encodedPayload = Buffer.from(
      JSON.stringify(payload),
      'utf8',
    ).toString('base64url');
    // Signature validity does not matter for header checks: the strategy is
    // exercised with an already-decoded CompleteJwt.
    return `${encodedHeader}.${encodedPayload}.c2lnbmF0dXJl`;
  }

  function decodeComplete(
    token: string,
    signingSecret: string,
  ): CompleteJwtShape {
    const [encodedHeader, encodedPayload, signature] = token.split('.') as [
      string,
      string,
      string,
    ];

    const header = JSON.parse(
      Buffer.from(encodedHeader, 'base64url').toString('utf8'),
    ) as CompleteJwtShape['header'];
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as CompleteJwtShape['payload'];

    void signingSecret;

    return { header, payload, signature };
  }

  interface CompleteJwtShape {
    header: { alg: string; typ?: string };
    payload: Record<string, unknown>;
    signature: string;
  }
});
