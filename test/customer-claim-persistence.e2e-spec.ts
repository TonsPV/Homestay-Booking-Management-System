import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/http';
import migrationDataSource from '../src/database/data-source';
import { CustomerClaimChallengeService } from '../src/module/auth/customer-claim-challenge.service';
import { PasswordHasherService } from '../src/module/auth/password-hasher.service';
import {
  CustomerClaimChallenge,
  CustomerClaimChallengeStatus,
} from '../src/module/auth/schema/customer-claim-challenge.entity';
import { Customer } from '../src/module/customer/schema/customer.entity';
import { E2eHarness } from './e2e-harness';

describe('Customer claim persistence (e2e)', () => {
  let app: INestApplication;
  let harness: E2eHarness | undefined;
  let customers: Repository<Customer>;
  let challenges: Repository<CustomerClaimChallenge>;
  let claimChallenges: CustomerClaimChallengeService;
  let passwordHasher: PasswordHasherService;
  const customerIds: string[] = [];
  const suffix = E2eHarness.createUniqueSuffix();
  let sequence = 0;

  beforeAll(async () => {
    harness = new E2eHarness(migrationDataSource);
    await harness.initialize();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    const dataSource = app.get(DataSource);
    customers = dataSource.getRepository(Customer);
    challenges = dataSource.getRepository(CustomerClaimChallenge);
    claimChallenges = app.get(CustomerClaimChallengeService);
    passwordHasher = app.get(PasswordHasherService);

    harness.registerCleanup(async () => {
      if (customerIds.length > 0) {
        await challenges
          .createQueryBuilder()
          .delete()
          .where('customer_id IN (:...customerIds)', { customerIds })
          .execute();
        await customers.delete([...new Set(customerIds)]);
      }
    });
  });

  afterAll(async () => {
    try {
      await harness?.cleanup();
    } finally {
      await app?.close();
    }
  });

  it('serializes concurrent challenge creation and leaves one pending challenge', async () => {
    const customer = await createCustomer({ passwordHash: null });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

    const results = await Promise.all([
      claimChallenges.createPendingChallenge(
        {
          customerId: customer.id,
          phoneSnapshot: customer.phone,
          otpHash: 'otp-hash-a',
          expiresAt,
        },
        now,
      ),
      claimChallenges.createPendingChallenge(
        {
          customerId: customer.id,
          phoneSnapshot: customer.phone,
          otpHash: 'otp-hash-b',
          expiresAt,
        },
        now,
      ),
    ]);

    expect(results.every((result) => result.created)).toBe(true);
    const saved = await challenges.findBy({ customerId: customer.id });
    expect(saved).toHaveLength(2);
    expect(
      saved.filter(
        (challenge) =>
          challenge.status === CustomerClaimChallengeStatus.PENDING,
      ),
    ).toHaveLength(1);
    expect(
      saved.filter(
        (challenge) =>
          challenge.status === CustomerClaimChallengeStatus.EXPIRED,
      ),
    ).toHaveLength(1);
  });

  it('does not create challenges for configured or locked Customers', async () => {
    const configured = await createCustomer({
      passwordHash: await passwordHasher.hash('StrongPassword123!'),
    });
    const locked = await createCustomer({
      passwordHash: null,
      status: 'LOCKED',
    });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

    await expect(
      claimChallenges.createPendingChallenge(
        {
          customerId: configured.id,
          phoneSnapshot: configured.phone,
          otpHash: 'otp-hash-configured',
          expiresAt,
        },
        now,
      ),
    ).resolves.toEqual({
      created: false,
      reason: 'PASSWORD_ALREADY_CONFIGURED',
    });
    await expect(
      claimChallenges.createPendingChallenge(
        {
          customerId: locked.id,
          phoneSnapshot: locked.phone,
          otpHash: 'otp-hash-locked',
          expiresAt,
        },
        now,
      ),
    ).resolves.toEqual({ created: false, reason: 'ACCOUNT_LOCKED' });
    expect(
      await challenges.countBy([
        { customerId: configured.id },
        { customerId: locked.id },
      ]),
    ).toBe(0);
  });

  async function createCustomer(
    overrides: Partial<Customer>,
  ): Promise<Customer> {
    sequence += 1;
    const phone = '+849' + String(10_000_000 + sequence).slice(-8);
    const customer = await customers.save(
      customers.create({
        fullName: 'Claim persistence Customer ' + sequence,
        email: `claim-persistence-${suffix}-${sequence}@example.com`,
        phone,
        passwordHash: null,
        phoneVerifiedAt: null,
        status: 'ACTIVE',
        tokenVersion: 0,
        ...overrides,
      }),
    );
    customerIds.push(customer.id);
    return customer;
  }
});
