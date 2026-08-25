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
