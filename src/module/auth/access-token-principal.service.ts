import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import type { AccessTokenPayload } from './auth.types';
import type { AuthenticatedPrincipal } from './authenticated-principal';
import { CustomerAuthorizationReader } from './authorization/customer-authorization-reader';
import { UserAuthorizationReader } from './authorization/user-authorization-reader';

/**
 * Resolves the application authentication state for an already-cryptographically
 * verified and claim-validated access token payload.
 *
 * Responsibilities:
 * - loads the customer/user authorization state through the readers;
 * - rejects missing accounts and revoked token versions (401);
 * - rejects LOCKED accounts (403);
 * - refreshes the user role from the database (the DB role, not the JWT role,
 *   is the authorization source of truth);
 * - returns the canonical AuthenticatedPrincipal.
 *
 * This service performs NO JWT parsing, NO signature verification, and does
 * not depend on ExecutionContext, Request, or Socket — so the same resolution
 * path is reusable by a future WebSocket gateway.
 */
@Injectable()
export class AccessTokenPrincipalService {
  constructor(
    private readonly userAuth: UserAuthorizationReader,
    private readonly customerAuth: CustomerAuthorizationReader,
  ) {}

  async resolve(payload: AccessTokenPayload): Promise<AuthenticatedPrincipal> {
    if (payload.actor_type === 'customer') {
      return this.resolveCustomer(payload);
    }

    return this.resolveUser(payload);
  }

  private async resolveCustomer(
    payload: AccessTokenPayload,
  ): Promise<AuthenticatedPrincipal> {
    const customerId = payload.customer_id;
    const tokenVersion = payload.token_version;

    if (customerId === undefined || tokenVersion === undefined) {
      throw new UnauthorizedException('Invalid access token.');
    }

    const customer = await this.customerAuth.findById(customerId);

    if (customer === null || customer.tokenVersion !== tokenVersion) {
      throw new UnauthorizedException('Invalid access token.');
    }

    if (customer.status === 'LOCKED') {
      throw new ForbiddenException('Tai khoan bi khoa.');
    }

    return {
      actorType: 'customer',
      sub: payload.sub,
      customerId,
      tokenVersion,
      iat: payload.iat,
      exp: payload.exp,
    };
  }

  private async resolveUser(
    payload: AccessTokenPayload,
  ): Promise<AuthenticatedPrincipal> {
    const userId = payload.user_id;
    const tokenVersion = payload.token_version;

    if (userId === undefined || tokenVersion === undefined) {
      throw new UnauthorizedException('Invalid access token.');
    }

    const user = await this.userAuth.findById(userId);

    if (user === null || user.tokenVersion !== tokenVersion) {
      throw new UnauthorizedException('Invalid access token.');
    }

    if (user.status === 'LOCKED') {
      throw new ForbiddenException('Tai khoan bi khoa.');
    }

    return {
      actorType: 'user',
      sub: payload.sub,
      userId,
      tokenVersion,
      role: user.role,
      iat: payload.iat,
      exp: payload.exp,
    };
  }
}
