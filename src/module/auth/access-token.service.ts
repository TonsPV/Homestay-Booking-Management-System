import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { parseDurationToSeconds } from '../../config/duration';
import { AccessTokenClaimsValidator } from './access-token-claims.validator';
import type {
  AccessTokenPayload,
  AccessTokenSubject,
  CompleteJwt,
} from './auth.types';

const JWT_LIBRARY_ERROR_NAMES = new Set([
  'JsonWebTokenError',
  'TokenExpiredError',
  'NotBeforeError',
]);

/** Error class names produced by jsonwebtoken verification failures. */
export { JWT_LIBRARY_ERROR_NAMES };

/**
 * Access-token facade: issuance, JWT verification, and JWT configuration.
 *
 * The cryptographic primitives (HMAC-SHA256, base64url, serialization) are
 * delegated to @nestjs/jwt (jsonwebtoken). The verification pipeline is:
 * library signature/serialization checks -> header alg/typ check ->
 * AccessTokenClaimsValidator (custom-claim invariants + temporary validity).
 *
 * This service never touches the database, never resolves roles, never checks
 * account status, and never depends on an HTTP request or a WebSocket — so the
 * same verify() can back a future Socket.IO handshake.
 */
@Injectable()
export class AccessTokenService {
  private readonly algorithm = 'HS256';
  private readonly tokenType = 'JWT';

  constructor(
    private readonly configService: ConfigService,
    private readonly claimsValidator: AccessTokenClaimsValidator,
    private readonly jwtService: JwtService,
  ) {}

  getExpiresInSeconds(): number {
    const value = this.configService.getOrThrow<string>(
      'JWT_ACCESS_TOKEN_EXPIRES_IN',
    );

    try {
      return parseDurationToSeconds(value);
    } catch {
      throw new Error('JWT access token duration is invalid.');
    }
  }

  sign(subject: AccessTokenSubject): string {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = this.getExpiresInSeconds();
    const payload: AccessTokenPayload = {
      sub: this.getSubject(subject),
      actor_type: subject.actorType,
      iat: now,
      exp: now + expiresIn,
    };

    if (subject.actorType === 'customer') {
      payload.customer_id = this.requireId(subject.customerId);
      payload.token_version = this.requireTokenVersion(subject.tokenVersion);
    }

    if (subject.actorType === 'user') {
      payload.user_id = this.requireId(subject.userId);
      payload.token_version = this.requireTokenVersion(subject.tokenVersion);

      if (subject.role !== undefined) {
        payload.role = subject.role;
      }
    }

    // The expiry and issued-at claims are computed here (not via the library's
    // `expiresIn` option) so the duration grammar and TTL semantics keep their
    // exact, tested behavior regardless of library defaults.
    return this.jwtService.sign(payload, {
      secret: this.getSecret(),
      algorithm: this.algorithm,
    });
  }

  verify(token: string): AccessTokenPayload {
    const decoded = this.decodeVerifiedToken(token);

    if (
      decoded.header.alg !== this.algorithm ||
      decoded.header.typ !== this.tokenType
    ) {
      throw new UnauthorizedException('Invalid access token.');
    }

    const accessTokenPayload = this.claimsValidator.validate(decoded.payload);

    this.claimsValidator.enforceTemporaryValidity(
      accessTokenPayload,
      Math.floor(Date.now() / 1000),
    );

    return accessTokenPayload;
  }

  private decodeVerifiedToken(token: string): CompleteJwt {
    let decoded: unknown;

    try {
      // ignoreExpiration / ignoreNotBefore keep the current contract exactly:
      // expiry and the iat/exp invariants are enforced by the claims validator
      // below (same boundaries, same messages), and `nbf` stays unenforced.
      decoded = this.jwtService.verify(token, {
        secret: this.getSecret(),
        algorithms: [this.algorithm],
        ignoreExpiration: true,
        ignoreNotBefore: true,
        complete: true,
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      if (error instanceof Error && JWT_LIBRARY_ERROR_NAMES.has(error.name)) {
        throw new UnauthorizedException('Invalid access token.');
      }

      // Configuration or unexpected system errors must stay observable.
      throw error;
    }

    if (
      decoded === null ||
      typeof decoded !== 'object' ||
      Array.isArray(decoded) ||
      !this.isCompleteJwt(decoded)
    ) {
      throw new UnauthorizedException('Invalid access token.');
    }

    return decoded;
  }

  private isCompleteJwt(value: object): value is CompleteJwt {
    const candidate = value as Partial<CompleteJwt>;
    const header = candidate.header as { alg?: unknown } | undefined;

    return (
      typeof header === 'object' &&
      header !== null &&
      typeof header.alg === 'string' &&
      typeof candidate.payload === 'object' &&
      candidate.payload !== null &&
      !Array.isArray(candidate.payload) &&
      typeof candidate.signature === 'string'
    );
  }

  private getSecret(): string {
    return this.configService.getOrThrow<string>('JWT_ACCESS_TOKEN_SECRET');
  }

  private getSubject(subject: AccessTokenSubject): string {
    if (subject.actorType === 'customer') {
      return `customer:${this.requireId(subject.customerId)}`;
    }

    return `user:${this.requireId(subject.userId)}`;
  }

  private requireId(value: string | undefined): string {
    if (value === undefined || value.length === 0) {
      throw new Error('Access token subject id is required.');
    }

    return value;
  }

  private requireTokenVersion(value: number | undefined): number {
    if (value === undefined || !Number.isInteger(value) || value < 0) {
      throw new Error('User token version is required.');
    }

    return value;
  }
}
