import { UnauthorizedException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';

import type { UserRole } from '../../common/domain/account.enums';
import type { AccessTokenPayload } from './auth.types';

/**
 * Pure, synchronous validation of a decoded JWT payload's custom-claim
 * invariants.
 *
 * Responsibilities (and limits):
 * - validates sub / actor_type / actor-specific id / token_version / role /
 *   iat / exp structure;
 * - enforces iat <= now + 60s clock skew, exp > iat, and the expiry boundary;
 * - performs NO database access, NO HTTP handling, and NO signature checks —
 *   cryptographic verification happens before this component runs.
 */
@Injectable()
export class AccessTokenClaimsValidator {
  private readonly maxClockSkewSeconds = 60;

  validate(payload: Record<string, unknown>): AccessTokenPayload {
    const sub = this.readString(payload, 'sub');
    const actorType = payload.actor_type;
    const iat = this.readNumber(payload, 'iat');
    const exp = this.readNumber(payload, 'exp');

    if (actorType !== 'customer' && actorType !== 'user') {
      throw new UnauthorizedException('Invalid access token.');
    }

    if (actorType === 'customer') {
      const customerId = this.readString(payload, 'customer_id');
      const tokenVersion = this.readTokenVersion(payload, 'token_version');

      if (sub !== `customer:${customerId}`) {
        throw new UnauthorizedException('Invalid access token.');
      }

      return {
        sub,
        actor_type: actorType,
        customer_id: customerId,
        token_version: tokenVersion,
        iat,
        exp,
      };
    }

    const userId = this.readString(payload, 'user_id');
    const role = this.readOptionalRole(payload, 'role');
    const tokenVersion = this.readTokenVersion(payload, 'token_version');

    if (sub !== `user:${userId}`) {
      throw new UnauthorizedException('Invalid access token.');
    }

    return {
      sub,
      actor_type: actorType,
      user_id: userId,
      role,
      token_version: tokenVersion,
      iat,
      exp,
    };
  }

  assertTimeValid(payload: AccessTokenPayload, nowSeconds: number): void {
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);

    if (payload.iat > now + this.maxClockSkewSeconds) {
      throw new UnauthorizedException('Invalid access token.');
    }

    if (payload.exp <= payload.iat) {
      throw new UnauthorizedException('Invalid access token.');
    }

    if (payload.exp <= now) {
      throw new UnauthorizedException('Access token has expired.');
    }
  }

  private readString(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];

    if (typeof value !== 'string' || value.length === 0) {
      throw new UnauthorizedException('Invalid access token.');
    }

    return value;
  }

  private readOptionalString(
    payload: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = payload[key];

    if (value === undefined) {
      return undefined;
    }

    if (typeof value !== 'string' || value.length === 0) {
      throw new UnauthorizedException('Invalid access token.');
    }

    return value;
  }

  private readOptionalRole(
    payload: Record<string, unknown>,
    key: string,
  ): UserRole | undefined {
    const value = this.readOptionalString(payload, key);

    if (value === undefined) {
      return undefined;
    }

    if (value !== 'STAFF' && value !== 'ADMIN') {
      throw new UnauthorizedException('Invalid access token.');
    }

    return value;
  }

  private readNumber(payload: Record<string, unknown>, key: string): number {
    const value = payload[key];

    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new UnauthorizedException('Invalid access token.');
    }

    return value;
  }

  private readTokenVersion(
    payload: Record<string, unknown>,
    key: string,
  ): number {
    const value = this.readNumber(payload, key);

    if (value < 0) {
      throw new UnauthorizedException('Invalid access token.');
    }

    return value;
  }
}
