import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { requiredPhone } from '../../common/validation';
import { Customer } from '../customer/schema/customer.entity';
import {
  CustomerClaimEligibilityReason,
  CustomerClaimPolicy,
} from './customer-claim.policy';
import {
  CustomerClaimChallenge,
  CustomerClaimChallengeStatus,
  CustomerClaimPurpose,
} from './schema/customer-claim-challenge.entity';

interface CreatePendingCustomerClaimInput {
  customerId: string;
  phoneSnapshot: string;
  otpHash: string;
  expiresAt: Date;
}

export type CreatePendingCustomerClaimResult =
  | {
      created: true;
      challenge: CustomerClaimChallenge;
    }
  | {
      created: false;
      reason: Exclude<
        CustomerClaimEligibilityReason,
        CustomerClaimEligibilityReason.ELIGIBLE
      >;
    };

@Injectable()
export class CustomerClaimChallengeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly customerClaimPolicy: CustomerClaimPolicy,
  ) {}

  async createPendingChallenge(
    input: CreatePendingCustomerClaimInput,
    now = new Date(),
  ): Promise<CreatePendingCustomerClaimResult> {
    this.validateCustomerId(input.customerId);
    const phoneSnapshot = requiredPhone(input.phoneSnapshot);
    this.validateHash(input.otpHash, 'OTP hash is invalid.');

    if (
      Number.isNaN(input.expiresAt.getTime()) ||
      input.expiresAt.getTime() <= now.getTime()
    ) {
      throw new BadRequestException('OTP expiry is invalid.');
    }

    return this.dataSource.transaction(async (manager) => {
      const customersRepository = manager.getRepository(Customer);
      const customer = await customersRepository
        .createQueryBuilder('customer')
        .addSelect('customer.passwordHash')
        .where('customer.id = :customerId', {
          customerId: input.customerId,
        })
        .andWhere('customer.deletedAt IS NULL')
        .setLock('pessimistic_write')
        .getOne();
      const eligibility = this.customerClaimPolicy.evaluateCustomer(customer);

      switch (eligibility) {
        case CustomerClaimEligibilityReason.CUSTOMER_NOT_FOUND:
        case CustomerClaimEligibilityReason.ACCOUNT_LOCKED:
        case CustomerClaimEligibilityReason.PASSWORD_ALREADY_CONFIGURED:
          return { created: false, reason: eligibility };
        case CustomerClaimEligibilityReason.ELIGIBLE:
          break;
      }

      if (customer === null) {
        throw new Error('Eligible Customer was not loaded.');
      }

      if (requiredPhone(customer.phone) !== phoneSnapshot) {
        throw new BadRequestException(
          'Phone snapshot does not match the Customer phone.',
        );
      }

      const challengesRepository = manager.getRepository(
        CustomerClaimChallenge,
      );
      await challengesRepository
        .createQueryBuilder()
        .update(CustomerClaimChallenge)
        .set({ status: CustomerClaimChallengeStatus.EXPIRED })
        .where('customer_id = :customerId', { customerId: customer.id })
        .andWhere('purpose = :purpose', {
          purpose: CustomerClaimPurpose.CLAIM_ACCOUNT,
        })
        .andWhere('status = :status', {
          status: CustomerClaimChallengeStatus.PENDING,
        })
        .execute();

      const challenge = challengesRepository.create({
        customerId: customer.id,
        phoneSnapshot,
        otpHash: input.otpHash,
        claimTokenHash: null,
        purpose: CustomerClaimPurpose.CLAIM_ACCOUNT,
        status: CustomerClaimChallengeStatus.PENDING,
        attemptCount: 0,
        expiresAt: input.expiresAt,
        verifiedAt: null,
        claimTokenExpiresAt: null,
        consumedAt: null,
      });

      return {
        created: true,
        challenge: await challengesRepository.save(challenge),
      };
    });
  }

  private validateCustomerId(customerId: string): void {
    if (!/^[1-9][0-9]*$/.test(customerId)) {
      throw new BadRequestException('Customer id is invalid.');
    }
  }

  private validateHash(value: string, message: string): void {
    if (value.length === 0 || value.length > 255) {
      throw new BadRequestException(message);
    }
  }
}
