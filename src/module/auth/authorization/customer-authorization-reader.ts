import type { AccountStatus } from '../../../common/domain/account.enums';

export interface CustomerAuthorizationState {
  id: string;
  status: AccountStatus;
  tokenVersion: number;
}

export abstract class CustomerAuthorizationReader {
  abstract findById(id: string): Promise<CustomerAuthorizationState | null>;
}
