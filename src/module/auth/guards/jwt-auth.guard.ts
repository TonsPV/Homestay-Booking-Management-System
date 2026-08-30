import {
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { JWT_LIBRARY_ERROR_NAMES } from '../access-token.service';
import { principalToAuth } from '../access-token-adapter';
import type { AuthenticatedRequest } from '../auth.types';

const MISSING_TOKEN_CHALLENGE = 'Authorization bearer token is required.';
const TOKEN_EXPIRED_ERROR_NAME = 'TokenExpiredError';

/**
 * Legacy public error contract, restored at the HTTP adapter boundary:
 *
 * - no strict `Bearer <token>` in the Authorization header
 *   → 401 `Authorization bearer token is required.`;
 * - a token was present but jsonwebtoken rejected it (malformed token,
 *   wrong signature, wrong algorithm) → 401 `Invalid access token.`;
 * - HttpExceptions thrown by the strategy pipeline (wrong typ, invalid
 *   claims, expired token, missing/revoked account, LOCKED) pass through
 *   untouched;
 * - anything else (DB outage, programming errors) keeps bubbling as 5xx —
 *   never masked as an authentication failure.
 *
 * No Passport-specific error handling leaks into AccessTokenService, the
 * claims validator, or the principal service.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = request.user;

    if (principal === undefined) {
      throw new UnauthorizedException(MISSING_TOKEN_CHALLENGE);
    }

    request.auth = principalToAuth(principal);

    return true;
  }

  public override handleRequest<TUser>(
    err: unknown,
    user: TUser | null | false | undefined,
    info: unknown,
    // Signature must match the passport mixin's handleRequest; the context is
    // not needed for the mapping itself.
    context: ExecutionContext,
    status?: unknown,
  ): TUser {
    void context;
    void status;

    if (err !== null && err !== undefined) {
      throw this.mapError(err);
    }

    if (user === null || user === undefined || user === false) {
      throw this.mapInfo(info);
    }

    return user;
  }

  /**
   * Error-path mapping: an error propagated through passport's error()
   * channel (strategy exceptions and jsonwebtoken verification failures).
   * Exported for characterization tests; every branch keeps the pre-Passport
   * contract.
   */
  mapError(err: unknown): unknown {
    if (err instanceof UnauthorizedException) {
      return err;
    }

    if (err instanceof Error && err.name === TOKEN_EXPIRED_ERROR_NAME) {
      return new UnauthorizedException('Access token has expired.');
    }

    if (err instanceof Error && JWT_LIBRARY_ERROR_NAMES.has(err.name)) {
      // jsonwebtoken rejection: malformed token, wrong signature, wrong
      // algorithm (all probed to surface as JsonWebTokenError).
      return new UnauthorizedException('Invalid access token.');
    }

    // Anything else — HttpExceptions from the strategy pipeline (403 LOCKED,
    // the dedicated expired message, etc.) and unexpected DB/system failures
    // — bubbles unchanged.
    return err;
  }

  /**
   * Info-path mapping: the strategy finished without a user via passport's
   * fail() channel. The only challenge this pipeline produces is the strict
   * extractor returning null — the missing/malformed Authorization header
   * case. Exported for characterization tests.
   */
  mapInfo(info: unknown): unknown {
    if (
      info instanceof Error &&
      info.message === 'No auth token' &&
      // jsonwebtoken errors never carry this message today; the name guard
      // keeps this mapping stable if that ever changes.
      !JWT_LIBRARY_ERROR_NAMES.has(info.name)
    ) {
      return new UnauthorizedException(
        'Authorization bearer token is required.',
      );
    }

    if (
      info instanceof UnauthorizedException ||
      info instanceof ForbiddenException
    ) {
      return info;
    }

    if (info instanceof Error && info.name === TOKEN_EXPIRED_ERROR_NAME) {
      return new UnauthorizedException('Access token has expired.');
    }

    if (info instanceof Error && JWT_LIBRARY_ERROR_NAMES.has(info.name)) {
      return new UnauthorizedException('Invalid access token.');
    }

    return new UnauthorizedException(MISSING_TOKEN_CHALLENGE);
  }
}
