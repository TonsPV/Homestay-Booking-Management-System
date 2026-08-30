import type { ActorType, UserRole } from '../../common/domain/account.enums';
import type { AppRequest } from '../../common/http/request.types';

export interface AccessTokenPayload {
  sub: string;
  actor_type: ActorType;
  customer_id?: string;
  user_id?: string;
  role?: UserRole;
  token_version?: number;
  iat: number;
  exp: number;
}

export interface AccessTokenSubject {
  actorType: ActorType;
  customerId?: string;
  userId?: string;
  role?: UserRole;
  tokenVersion?: number;
}

export interface AuthenticatedRequest extends AppRequest<AccessTokenPayload> {
  auth: AccessTokenPayload;
}

/** Decoded JWT as returned by `jwt.verify(..., { complete: true })`. */
export interface CompleteJwt {
  header: {
    alg: string;
    typ?: string;
  };
  payload: Record<string, unknown>;
  signature: string;
}
