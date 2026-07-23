import type { AccountStatus, UserRole } from './auth.types';

export interface UserAuthorizationState {
  id: string;
  role: UserRole;
  status: AccountStatus;
  tokenVersion: number;
}

export abstract class UserAuthorizationReader {
  abstract findById(id: string): Promise<UserAuthorizationState | null>;
}
