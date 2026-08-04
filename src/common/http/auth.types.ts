import type { Request } from 'express';

export {
  AccountStatusEnum,
  ActorTypeEnum,
  UserRoleEnum,
} from '../domain/account.enums';
export type {
  AccountStatus,
  ActorType,
  UserRole,
} from '../domain/account.enums';

import type { ActorType, UserRole } from '../domain/account.enums';

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

export interface AppRequest<TAuth = unknown> extends Request {
  auth?: TAuth;
  requestId?: string;
}

export interface AuthenticatedRequest extends AppRequest<AccessTokenPayload> {
  auth: AccessTokenPayload;
}
