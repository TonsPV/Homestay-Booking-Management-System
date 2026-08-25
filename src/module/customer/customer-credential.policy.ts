import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { ErrorCode } from '../../common/error-codes';
import { Customer } from './schema/customer.entity';

export const CUSTOMER_CREDENTIAL_CAPABILITY_REASON_CODES = [
  ErrorCode.CUSTOMER_INITIAL_PASSWORD_ALREADY_CONFIGURED,
  ErrorCode.COMMON_NOT_FOUND,
] as const;

export type CustomerCredentialCapabilityReasonCode =
  (typeof CUSTOMER_CREDENTIAL_CAPABILITY_REASON_CODES)[number] | null;

export interface CustomerCredentialCapabilities {
  canSetInitialPassword: boolean;
  reasonCode: CustomerCredentialCapabilityReasonCode;
}

@Injectable()
export class CustomerCredentialPolicy {
  constructor(
    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,
  ) {}

  evaluate(
    customer: Pick<Customer, 'passwordHash'> | null,
  ): CustomerCredentialCapabilities {
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

  async evaluateByCustomerId(
    customerId: string,
  ): Promise<CustomerCredentialCapabilities> {
    const customer = await this.customersRepository
      .createQueryBuilder('customer')
      .addSelect('customer.passwordHash')
      .where('customer.id = :customerId', { customerId })
      .andWhere('customer.deletedAt IS NULL')
      .getOne();

    return this.evaluate(customer);
  }
}
