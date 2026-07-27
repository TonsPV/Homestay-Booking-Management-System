import type { AccountStatus } from './auth.types';

export interface CustomerAuthorizationState {
  id: string;
  status: AccountStatus;
  tokenVersion: number;
}

export abstract class CustomerAuthorizationReader {
  abstract findById(id: string): Promise<CustomerAuthorizationState | null>;
}
