import type {
  AccountStatus,
  AccountStatus as CustomerStatus,
} from '../../common/account/account.enums';
import type { PaginationMeta } from '../../common/pagination/pagination.types';
import { ErrorCode } from '../../common/error-codes';

export interface AdminCustomerResponse {
  id: string;
  fullName: string;
  email: string | null;
  phone: string;
  status: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
  credentialCapabilities: CredentialCapabilities;
}

export interface AdminCustomerListResponse {
  items: AdminCustomerResponse[];
  meta: PaginationMeta;
}

export interface ProfileResponse {
  id: string;
  fullName: string;
  email: string | null;
  phone: string;
  status: CustomerStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CredentialResult {
  passwordConfigured: true;
}

export const CREDENTIAL_REASON_CODES = [
  ErrorCode.CUSTOMER_INITIAL_PASSWORD_ALREADY_CONFIGURED,
  ErrorCode.COMMON_NOT_FOUND,
] as const;

export type CredentialReasonCode =
  (typeof CREDENTIAL_REASON_CODES)[number] | null;

export interface CredentialCapabilities {
  canSetInitialPassword: boolean;
  reasonCode: CredentialReasonCode;
}
