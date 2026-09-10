import type {
  AccountStatus as CustomerStatus,
  AccountStatus as UserStatus,
  ActorType,
  UserRole,
} from '../../common/account/account.enums';

import type { AppRequest } from '../../common/http/request.types';
import type { AuthenticatedPrincipal } from './authenticated-principal';

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

export interface AuthenticatedRequest extends AppRequest<
  AccessTokenPayload,
  AuthenticatedPrincipal
> {
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

export interface CustomerResponse {
  id: string;
  fullName: string;
  email: string | null;
  phone: string;
  status: CustomerStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserResponse {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  actorType: 'customer' | 'user';
  customer?: CustomerResponse;
  user?: UserResponse;
}

export interface RegistrationResult {
  accepted: true;
}

export type MeResponse =
  | {
      actorType: 'customer';
      customer: CustomerResponse;
    }
  | {
      actorType: 'user';
      user: UserResponse;
    };
