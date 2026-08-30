import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';

import type { CompleteJwt } from '../auth.types';
import type { AuthenticatedPrincipal } from '../authenticated-principal';
import { AccessTokenClaimsValidator } from '../access-token-claims.validator';
import { AccessTokenPrincipalService } from '../access-token-principal.service';

/**
 * The strict pre-Passport authorization grammar:
 * `Bearer <one whitespace-delimited segment>` — nothing looser.
 */
export const STRICT_BEARER_PATTERN = /^Bearer ([^\s]+)$/;

/**
 * Extracts the token with the strict grammar above.
 *
 * ExtractJwt.fromAuthHeaderWithScheme() splits on /\s+/ and would accept
 * inputs the strict regex rejects (e.g. `Bearer a b` yields `a`), so the
 * grammar is re-implemented here and characterization-tested.
 */
export const strictBearerExtractor: (request: unknown) => string | null = (
  request: unknown,
) => {
  const header = (
    request as { headers?: { authorization?: unknown } } | null | undefined
  )?.headers?.authorization;

  if (typeof header !== 'string') {
    return null;
  }

  const match = STRICT_BEARER_PATTERN.exec(header);

  return match === null ? null : (match[1] ?? null);
};

/**
 * HTTP Passport adapter for JWT authentication (verification pipeline only).
 *
 * passport-jwt/jsonwebtoken performs the cryptographic verification (HMAC,
 * serialization); this strategy then checks the header alg/typ, delegates
 * custom-claim validation to AccessTokenClaimsValidator, resolves the
 * application authentication state through AccessTokenPrincipalService, and
 * returns the canonical AuthenticatedPrincipal (becomes `request.user`).
 *
 * No role/actor authorization here — ActorsGuard/RolesGuard keep owning it.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly claimsValidator: AccessTokenClaimsValidator,
    private readonly accessTokenPrincipalService: AccessTokenPrincipalService,
  ) {
    super({
      jwtFromRequest: strictBearerExtractor,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_TOKEN_SECRET'),
      algorithms: ['HS256'],
      // Expiry and iat/exp invariants stay enforced by the claims validator
      // (same boundaries, same messages), so library expiry checking is off;
      // `nbf` remains unenforced to preserve the token contract.
      ignoreExpiration: true,
      jsonWebTokenOptions: {
        complete: true,
        ignoreNotBefore: true,
      },
    });
  }

  async validate(payload: unknown): Promise<AuthenticatedPrincipal> {
    const complete = this.readCompleteJwt(payload);

    if (complete.header.alg !== 'HS256' || complete.header.typ !== 'JWT') {
      throw new UnauthorizedException('Invalid access token.');
    }

    const accessTokenPayload = this.claimsValidator.validate(complete.payload);

    this.claimsValidator.enforceTemporaryValidity(
      accessTokenPayload,
      Math.floor(Date.now() / 1000),
    );

    return this.accessTokenPrincipalService.resolve(accessTokenPayload);
  }

  private readCompleteJwt(payload: unknown): CompleteJwt {
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload)
    ) {
      throw new UnauthorizedException('Invalid access token.');
    }

    const candidate = payload as Partial<CompleteJwt>;
    const header = candidate.header;

    if (
      header === null ||
      typeof header !== 'object' ||
      Array.isArray(header) ||
      typeof (header as { alg?: unknown }).alg !== 'string' ||
      typeof candidate.payload !== 'object' ||
      candidate.payload === null ||
      Array.isArray(candidate.payload) ||
      typeof candidate.signature !== 'string'
    ) {
      throw new UnauthorizedException('Invalid access token.');
    }

    return payload as CompleteJwt;
  }
}
