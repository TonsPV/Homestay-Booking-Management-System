import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { principalToAuth } from '../../../../src/module/auth/access-token-adapter';
import type { AuthenticatedRequest } from '../../../../src/module/auth/auth.types';
import type { AuthenticatedPrincipal } from '../../../../src/module/auth/authenticated-principal';
import { JwtAuthGuard } from '../../../../src/module/auth/guards/jwt-auth.guard';

describe('JwtAuthGuard — Passport failure mapping (handleRequest override)', () => {
  const principal: AuthenticatedPrincipal = {
    actorType: 'user',
    sub: 'user:user-1',
    userId: 'user-1',
    tokenVersion: 4,
    role: 'ADMIN',
    iat: 100,
    exp: 200,
  };

  // AuthGuard('jwt') is memoized: this is exactly the base class JwtAuthGuard
  // extends, so spying on its prototype intercepts super.canActivate() while
  // the overridden handleRequest() runs for real.
  const mixinBase = AuthGuard('jwt') as {
    prototype: { canActivate: (context: ExecutionContext) => Promise<boolean> };
  };
  let superCanActivate: jest.SpiedFunction<
    (context: ExecutionContext) => Promise<boolean>
  >;

  function createContext(
    passportFailure?: { err?: unknown; user?: unknown; info?: unknown },
    attachPrincipal = true,
  ): {
    context: ExecutionContext;
    request: Partial<AuthenticatedRequest>;
  } {
    const request: Partial<AuthenticatedRequest> = {};
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    superCanActivate.mockImplementation((ctx) => {
      const passport = passportFailure ?? {};

      if ('err' in passport) {
        throw passport.err;
      }

      if (attachPrincipal && passport.user !== null) {
        ctx.switchToHttp().getRequest<Partial<AuthenticatedRequest>>().user =
          (passport.user as AuthenticatedPrincipal) ?? principal;
      }

      return Promise.resolve(true);
    });

    return { context, request };
  }

  beforeEach(() => {
    superCanActivate = jest
      .spyOn(mixinBase.prototype, 'canActivate')
      .mockName('super.canActivate');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('derives request.auth from request.user (single source of truth)', async () => {
    const { context, request } = createContext();
    const guard = new JwtAuthGuard();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.auth).toEqual(principalToAuth(principal));
    expect(request.auth?.role).toBe('ADMIN');
    expect(request.auth?.actor_type).toBe('user');
    expect(request.auth?.token_version).toBe(4);
  });

  it('does not mutate the canonical request.user principal', async () => {
    const { context, request } = createContext();
    const guard = new JwtAuthGuard();
    const snapshot = structuredClone(principal);

    await guard.canActivate(context);

    expect(request.user).toEqual(snapshot);
  });

  describe('mapError — passport error() channel contract', () => {
    let guard: JwtAuthGuard;

    beforeEach(() => {
      guard = new JwtAuthGuard();
    });

    function jwtError(name: string, message: string): Error {
      const error = new Error(message);
      error.name = name;

      return error;
    }

    it('maps a malformed-token JsonWebTokenError to Invalid access token.', () => {
      const mapped = guard.mapError(
        jwtError('JsonWebTokenError', 'jwt malformed'),
      );

      expect(mapped).toBeInstanceOf(UnauthorizedException);
      expect((mapped as UnauthorizedException).message).toBe(
        'Invalid access token.',
      );
    });

    it('maps an invalid-signature JsonWebTokenError to Invalid access token.', () => {
      const mapped = guard.mapError(
        jwtError('JsonWebTokenError', 'invalid signature'),
      );

      expect((mapped as UnauthorizedException).message).toBe(
        'Invalid access token.',
      );
    });

    it('maps an invalid-algorithm JsonWebTokenError to Invalid access token.', () => {
      const mapped = guard.mapError(
        jwtError('JsonWebTokenError', 'invalid algorithm'),
      );

      expect((mapped as UnauthorizedException).message).toBe(
        'Invalid access token.',
      );
    });

    it('maps a TokenExpiredError to the dedicated expired message.', () => {
      const mapped = guard.mapError(
        jwtError('TokenExpiredError', 'jwt expired'),
      );

      expect((mapped as UnauthorizedException).message).toBe(
        'Access token has expired.',
      );
    });

    it('passes HttpExceptions from the strategy through untouched', () => {
      const locked = new ForbiddenException('Tai khoan bi khoa.');
      expect(guard.mapError(locked)).toBe(locked);

      const expired = new UnauthorizedException('Access token has expired.');
      expect(guard.mapError(expired)).toBe(expired);
    });

    it('lets unexpected failures bubble unchanged (no 401 masking)', () => {
      const dbError = new Error('db connection lost');
      expect(guard.mapError(dbError)).toBe(dbError);
    });
  });

  describe('mapInfo — passport fail() challenge contract', () => {
    let guard: JwtAuthGuard;

    beforeEach(() => {
      guard = new JwtAuthGuard();
    });

    it('maps the strict-extractor challenge to the required-header error', () => {
      const challenge = new Error('No auth token');

      const mapped = guard.mapInfo(challenge);

      expect(mapped).toBeInstanceOf(UnauthorizedException);
      expect((mapped as UnauthorizedException).message).toBe(
        'Authorization bearer token is required.',
      );
    });

    it('does not mistake a JWT-named error for the extractor challenge', () => {
      const jwtFailure = new Error('No auth token');
      jwtFailure.name = 'JsonWebTokenError';

      const mapped = guard.mapInfo(jwtFailure);

      expect((mapped as UnauthorizedException).message).toBe(
        'Invalid access token.',
      );
    });

    it('maps an expiration challenge to the dedicated expired message', () => {
      const expired = new Error('jwt expired');
      expired.name = 'TokenExpiredError';

      const mapped = guard.mapInfo(expired);

      expect((mapped as UnauthorizedException).message).toBe(
        'Access token has expired.',
      );
    });

    it('falls back to the access-token-required 401 for unknown shapes', () => {
      const mapped = guard.mapInfo(undefined);

      expect(mapped).toBeInstanceOf(UnauthorizedException);
      expect((mapped as UnauthorizedException).message).toBe(
        'Authorization bearer token is required.',
      );
    });
  });

  describe('full handleRequest flow (mapping runs for real)', () => {
    it('throws the mapped 401 when the strategy errors with a JWT failure', () => {
      const jwtError = new Error('invalid signature');
      jwtError.name = 'JsonWebTokenError';
      const guard = new JwtAuthGuard();

      expect(() =>
        guard.handleRequest(
          jwtError,
          undefined,
          undefined,
          {} as ExecutionContext,
        ),
      ).toThrow(new UnauthorizedException('Invalid access token.'));
    });

    it('throws the required-header 401 when only the extractor challenge arrives', () => {
      const guard = new JwtAuthGuard();

      expect(() =>
        guard.handleRequest(
          null,
          null,
          new Error('No auth token'),
          {} as ExecutionContext,
        ),
      ).toThrow(
        new UnauthorizedException('Authorization bearer token is required.'),
      );
    });

    it('propagates strategy HttpExceptions unchanged through handleRequest', () => {
      const guard = new JwtAuthGuard();

      expect(() =>
        guard.handleRequest(
          new ForbiddenException('Tai khoan bi khoa.'),
          undefined,
          undefined,
          {} as ExecutionContext,
        ),
      ).toThrow(new ForbiddenException('Tai khoan bi khoa.'));
    });
  });
});
