import {
  CustomerClaimEligibilityReason,
  CustomerClaimPolicy,
  CustomerClaimTransitionReason,
} from './customer-claim.policy';
import {
  CustomerClaimChallenge,
  CustomerClaimChallengeStatus,
  CustomerClaimPurpose,
} from './schema/customer-claim-challenge.entity';

describe('CustomerClaimPolicy', () => {
  const now = new Date('2026-08-02T02:00:00.000Z');
  let policy: CustomerClaimPolicy;

  beforeEach(() => {
    policy = new CustomerClaimPolicy();
  });

  it.each([
    {
      name: 'missing Customer',
      customer: null,
      reason: CustomerClaimEligibilityReason.CUSTOMER_NOT_FOUND,
    },
    {
      name: 'soft-deleted Customer',
      customer: {
        deletedAt: now,
        passwordHash: null,
        status: 'ACTIVE' as const,
      },
      reason: CustomerClaimEligibilityReason.CUSTOMER_NOT_FOUND,
    },
    {
      name: 'locked Customer',
      customer: {
        deletedAt: null,
        passwordHash: null,
        status: 'LOCKED' as const,
      },
      reason: CustomerClaimEligibilityReason.ACCOUNT_LOCKED,
    },
    {
      name: 'Customer with a password',
      customer: {
        deletedAt: null,
        passwordHash: 'scrypt-hash',
        status: 'ACTIVE' as const,
      },
      reason: CustomerClaimEligibilityReason.PASSWORD_ALREADY_CONFIGURED,
    },
    {
      name: 'active passwordless Customer',
      customer: {
        deletedAt: null,
        passwordHash: null,
        status: 'ACTIVE' as const,
      },
      reason: CustomerClaimEligibilityReason.ELIGIBLE,
    },
  ])('evaluates $name', ({ customer, reason }) => {
    expect(policy.evaluateCustomer(customer)).toBe(reason);
  });

  it('blocks a pending challenge at the maximum failed attempt', () => {
    const challenge = challengeFixture({ attemptCount: 4 });

    expect(policy.recordFailedAttempt(challenge, now, 5)).toEqual({
      transitioned: true,
      reason: CustomerClaimTransitionReason.ATTEMPTS_EXCEEDED,
    });
    expect(challenge.attemptCount).toBe(5);
    expect(challenge.status).toBe(CustomerClaimChallengeStatus.BLOCKED);
  });

  it('expires a challenge without incrementing attempts', () => {
    const challenge = challengeFixture({ expiresAt: new Date(now.getTime()) });

    expect(policy.recordFailedAttempt(challenge, now, 5)).toEqual({
      transitioned: true,
      reason: CustomerClaimTransitionReason.EXPIRED,
    });
    expect(challenge.attemptCount).toBe(0);
    expect(challenge.status).toBe(CustomerClaimChallengeStatus.EXPIRED);
  });

  it('verifies and consumes a challenge exactly once', () => {
    const challenge = challengeFixture();
    const claimExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);

    expect(
      policy.markVerified(
        challenge,
        now,
        5,
        'claim-token-hash',
        claimExpiresAt,
      ),
    ).toEqual({
      transitioned: true,
      reason: CustomerClaimTransitionReason.READY,
    });
    expect(challenge).toMatchObject({
      status: CustomerClaimChallengeStatus.VERIFIED,
      verifiedAt: now,
      claimTokenHash: 'claim-token-hash',
      claimTokenExpiresAt: claimExpiresAt,
    });

    expect(policy.markConsumed(challenge, new Date(now.getTime() + 1))).toEqual(
      {
        transitioned: true,
        reason: CustomerClaimTransitionReason.READY,
      },
    );
    expect(challenge.status).toBe(CustomerClaimChallengeStatus.CONSUMED);
    expect(policy.markConsumed(challenge, new Date(now.getTime() + 2))).toEqual(
      {
        transitioned: false,
        reason: CustomerClaimTransitionReason.NOT_PENDING,
      },
    );
  });

  it('expires a verified challenge whose claim token is no longer valid', () => {
    const challenge = challengeFixture({
      status: CustomerClaimChallengeStatus.VERIFIED,
      claimTokenHash: 'claim-token-hash',
      claimTokenExpiresAt: now,
      verifiedAt: new Date(now.getTime() - 1000),
    });

    expect(policy.markConsumed(challenge, now)).toEqual({
      transitioned: true,
      reason: CustomerClaimTransitionReason.CLAIM_TOKEN_EXPIRED,
    });
    expect(challenge.status).toBe(CustomerClaimChallengeStatus.EXPIRED);
  });
});

function challengeFixture(
  overrides: Partial<CustomerClaimChallenge> = {},
): CustomerClaimChallenge {
  return Object.assign(new CustomerClaimChallenge(), {
    id: 'challenge-id',
    customerId: '1',
    phoneSnapshot: '+84912345678',
    otpHash: 'otp-hash',
    claimTokenHash: null,
    purpose: CustomerClaimPurpose.CLAIM_ACCOUNT,
    status: CustomerClaimChallengeStatus.PENDING,
    attemptCount: 0,
    expiresAt: new Date('2026-08-02T02:05:00.000Z'),
    verifiedAt: null,
    claimTokenExpiresAt: null,
    consumedAt: null,
    createdAt: new Date('2026-08-02T02:00:00.000Z'),
    updatedAt: new Date('2026-08-02T02:00:00.000Z'),
    ...overrides,
  });
}
