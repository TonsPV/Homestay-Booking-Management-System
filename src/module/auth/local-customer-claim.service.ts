import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import { getVietnamesePhoneLookupVariants } from '../../common/validation';
import { Customer } from '../customer/schema/customer.entity';
import {
  CustomerClaimEligibilityReason,
  CustomerClaimPolicy,
} from './customer-claim.policy';

export enum LocalCustomerClaimResult {
  CLAIMED = 'CLAIMED',
  DISABLED = 'DISABLED',
  NOT_ELIGIBLE = 'NOT_ELIGIBLE',
  IDENTITY_CONFLICT = 'IDENTITY_CONFLICT',
}

export interface LocalCustomerClaimInput {
  phone: string;
  email: string | null;
  passwordHash: string;
}

@Injectable()
export class LocalCustomerClaimService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly customerClaimPolicy: CustomerClaimPolicy,
  ) {}

  isEnabled(): boolean {
    return (
      this.configService.get<boolean>('CUSTOMER_CLAIM_LOCAL_BYPASS_ENABLED') ===
      true
    );
  }

  async claimPasswordlessCustomer(
    input: LocalCustomerClaimInput,
  ): Promise<LocalCustomerClaimResult> {
    if (!this.isEnabled()) {
      return LocalCustomerClaimResult.DISABLED;
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(Customer);
        const customer = await repository
          .createQueryBuilder('customer')
          .addSelect('customer.passwordHash')
          .where('customer.deletedAt IS NULL')
          .andWhere('customer.phone IN (:...phones)', {
            phones: getVietnamesePhoneLookupVariants(input.phone),
          })
          .setLock('pessimistic_write')
          .getOne();
        const eligibility = this.customerClaimPolicy.evaluateCustomer(customer);

        if (
          customer === null ||
          eligibility !== CustomerClaimEligibilityReason.ELIGIBLE
        ) {
          return LocalCustomerClaimResult.NOT_ELIGIBLE;
        }

        if (input.email !== null) {
          if (
            customer.email !== null &&
            customer.email.toLowerCase() !== input.email
          ) {
            return LocalCustomerClaimResult.IDENTITY_CONFLICT;
          }

          const emailOwner = await repository
            .createQueryBuilder('customer')
            .where('customer.deletedAt IS NULL')
            .andWhere('LOWER(customer.email) = :email', { email: input.email })
            .setLock('pessimistic_read')
            .getOne();

          if (emailOwner !== null && emailOwner.id !== customer.id) {
            return LocalCustomerClaimResult.IDENTITY_CONFLICT;
          }

          customer.email ??= input.email;
        }

        customer.passwordHash = input.passwordHash;
        customer.tokenVersion += 1;
        await repository.save(customer);

        return LocalCustomerClaimResult.CLAIMED;
      });
    } catch (error) {
      if (getMysqlDuplicateKey(error) !== undefined) {
        return LocalCustomerClaimResult.IDENTITY_CONFLICT;
      }

      throw error;
    }
  }
}
