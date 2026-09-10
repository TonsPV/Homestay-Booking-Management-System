import type { CredentialCapabilities } from './customer.types';
import { Injectable } from '@nestjs/common';

import { ErrorCode } from '../../common/error-codes';
import type { Customer } from './schema/customer.entity';

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
