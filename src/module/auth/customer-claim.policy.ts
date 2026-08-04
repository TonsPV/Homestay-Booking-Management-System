import { Injectable } from '@nestjs/common';

import type { Customer } from '../customer/schema/customer.entity';
import {
  CustomerClaimChallenge,
  CustomerClaimChallengeStatus,
} from './schema/customer-claim-challenge.entity';

export enum CustomerClaimEligibilityReason {
  ELIGIBLE = 'ELIGIBLE',
  CUSTOMER_NOT_FOUND = 'CUSTOMER_NOT_FOUND',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  PASSWORD_ALREADY_CONFIGURED = 'PASSWORD_ALREADY_CONFIGURED',
}

export enum CustomerClaimTransitionReason {
  READY = 'READY',
  NOT_PENDING = 'NOT_PENDING',
  EXPIRED = 'EXPIRED',
  ATTEMPTS_EXCEEDED = 'ATTEMPTS_EXCEEDED',
  CLAIM_TOKEN_EXPIRED = 'CLAIM_TOKEN_EXPIRED',
}

export interface CustomerClaimTransitionResult {
  transitioned: boolean;
  reason: CustomerClaimTransitionReason;
}

@Injectable()
export class CustomerClaimPolicy {
  evaluateCustomer(
    customer: Pick<Customer, 'deletedAt' | 'passwordHash' | 'status'> | null,
  ): CustomerClaimEligibilityReason {
    if (customer === null || customer.deletedAt !== null) {
      return CustomerClaimEligibilityReason.CUSTOMER_NOT_FOUND;
    }

    if (customer.status === 'LOCKED') {
      return CustomerClaimEligibilityReason.ACCOUNT_LOCKED;
    }

    if (customer.passwordHash !== null) {
      return CustomerClaimEligibilityReason.PASSWORD_ALREADY_CONFIGURED;
    }

    return CustomerClaimEligibilityReason.ELIGIBLE;
  }

  recordFailedAttempt(
    challenge: CustomerClaimChallenge,
    now: Date,
    maxAttempts: number,
  ): CustomerClaimTransitionResult {
    const availability = this.getPendingAvailability(
      challenge,
      now,
      maxAttempts,
    );

    if (availability.reason !== CustomerClaimTransitionReason.READY) {
      return availability;
    }

    challenge.attemptCount += 1;

    if (challenge.attemptCount >= maxAttempts) {
      challenge.status = CustomerClaimChallengeStatus.BLOCKED;
      return {
        transitioned: true,
        reason: CustomerClaimTransitionReason.ATTEMPTS_EXCEEDED,
      };
    }

    return {
      transitioned: true,
      reason: CustomerClaimTransitionReason.READY,
    };
  }

  markVerified(
    challenge: CustomerClaimChallenge,
    now: Date,
    maxAttempts: number,
    claimTokenHash: string,
    claimTokenExpiresAt: Date,
  ): CustomerClaimTransitionResult {
    const availability = this.getPendingAvailability(
      challenge,
      now,
      maxAttempts,
    );

    if (availability.reason !== CustomerClaimTransitionReason.READY) {
      return availability;
    }

    if (claimTokenExpiresAt.getTime() <= now.getTime()) {
      throw new Error(
        'Claim token expiry must be later than verification time.',
      );
    }

    if (claimTokenHash.length === 0 || claimTokenHash.length > 255) {
      throw new Error('Claim token hash is invalid.');
    }

    challenge.status = CustomerClaimChallengeStatus.VERIFIED;
    challenge.verifiedAt = now;
    challenge.claimTokenHash = claimTokenHash;
    challenge.claimTokenExpiresAt = claimTokenExpiresAt;

    return {
      transitioned: true,
      reason: CustomerClaimTransitionReason.READY,
    };
  }

  markConsumed(
    challenge: CustomerClaimChallenge,
    now: Date,
  ): CustomerClaimTransitionResult {
    if (challenge.status !== CustomerClaimChallengeStatus.VERIFIED) {
      return {
        transitioned: false,
        reason: CustomerClaimTransitionReason.NOT_PENDING,
      };
    }

    if (
      challenge.claimTokenExpiresAt === null ||
      challenge.claimTokenExpiresAt.getTime() <= now.getTime()
    ) {
      challenge.status = CustomerClaimChallengeStatus.EXPIRED;
      return {
        transitioned: true,
        reason: CustomerClaimTransitionReason.CLAIM_TOKEN_EXPIRED,
      };
    }

    challenge.status = CustomerClaimChallengeStatus.CONSUMED;
    challenge.consumedAt = now;

    return {
      transitioned: true,
      reason: CustomerClaimTransitionReason.READY,
    };
  }

  private getPendingAvailability(
    challenge: CustomerClaimChallenge,
    now: Date,
    maxAttempts: number,
  ): CustomerClaimTransitionResult {
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
      throw new Error('Maximum OTP attempts must be a positive integer.');
    }

    if (challenge.status !== CustomerClaimChallengeStatus.PENDING) {
      return {
        transitioned: false,
        reason: CustomerClaimTransitionReason.NOT_PENDING,
      };
    }

    if (challenge.expiresAt.getTime() <= now.getTime()) {
      challenge.status = CustomerClaimChallengeStatus.EXPIRED;
      return {
        transitioned: true,
        reason: CustomerClaimTransitionReason.EXPIRED,
      };
    }

    if (challenge.attemptCount >= maxAttempts) {
      challenge.status = CustomerClaimChallengeStatus.BLOCKED;
      return {
        transitioned: true,
        reason: CustomerClaimTransitionReason.ATTEMPTS_EXCEEDED,
      };
    }

    return {
      transitioned: false,
      reason: CustomerClaimTransitionReason.READY,
    };
  }
}
