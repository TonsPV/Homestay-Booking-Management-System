import type { AccessTokenPayload } from './auth.types';
import type { AuthenticatedPrincipal } from './authenticated-principal';

/**
 * Deterministic compatibility adapter: derives the legacy
 * `request.auth` (AccessTokenPayload-compatible) view from the canonical
 * `request.user` (AuthenticatedPrincipal).
 *
 * The principal is the single source of authentication state; this mapping is
 * pure so both request properties can never drift apart. The user role is the
 * current database role carried on the principal.
 */
export function principalToAuth(
  principal: AuthenticatedPrincipal,
): AccessTokenPayload {
  if (principal.actorType === 'customer') {
    return {
      sub: principal.sub,
      actor_type: 'customer',
      customer_id: principal.customerId,
      token_version: principal.tokenVersion,
      iat: principal.iat,
      exp: principal.exp,
    };
  }

  return {
    sub: principal.sub,
    actor_type: 'user',
    user_id: principal.userId,
    role: principal.role,
    token_version: principal.tokenVersion,
    iat: principal.iat,
    exp: principal.exp,
  };
}
