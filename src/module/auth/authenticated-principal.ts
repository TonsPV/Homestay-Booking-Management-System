import type { ActorType, UserRole } from '../../common/domain/account.enums';

/**
 * Canonical, framework-agnostic authenticated principal resolved from a
 * validated access token plus current database authorization state.
 *
 * This is the shape carried on `request.user` once Passport is introduced.
 * It deliberately contains no ORM entity and no JWT cryptography concerns.
 */
export type AuthenticatedPrincipal =
  | {
      actorType: 'customer';
      sub: string;
      customerId: string;
      tokenVersion: number;
      iat: number;
      exp: number;
    }
  | {
      actorType: 'user';
      sub: string;
      userId: string;
      tokenVersion: number;
      /** Current database role — the authorization source of truth. */
      role: UserRole;
      iat: number;
      exp: number;
    };

export type AuthenticatedActorType = ActorType;

export type AuthenticatedPrincipalRole = UserRole;
