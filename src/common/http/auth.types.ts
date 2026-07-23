import type { Request } from 'express';

export type ActorType = 'customer' | 'user';
export type UserRole = 'STAFF' | 'ADMIN';
export type AccountStatus = 'ACTIVE' | 'LOCKED';

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
}

export interface AuthenticatedRequest extends AppRequest<AccessTokenPayload> {
  auth: AccessTokenPayload;
}
