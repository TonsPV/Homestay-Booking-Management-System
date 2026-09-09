import { Injectable } from '@nestjs/common';

import { ErrorCode } from '../../common/error-codes';
import type { Customer } from './schema/customer.entity';

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

@Injectable()
export class CustomerCredentialPolicy {
  evaluate(
    customer: Pick<Customer, 'passwordHash'> | null,
  ): CredentialCapabilities {
    if (customer === null) {
      return {
        canSetInitialPassword: false,
        reasonCode: ErrorCode.COMMON_NOT_FOUND,
      };
    }

    if (customer.passwordHash !== null) {
      return {
        canSetInitialPassword: false,
        reasonCode: ErrorCode.CUSTOMER_INITIAL_PASSWORD_ALREADY_CONFIGURED,
      };
    }

    return {
      canSetInitialPassword: true,
      reasonCode: null,
    };
  }
}
