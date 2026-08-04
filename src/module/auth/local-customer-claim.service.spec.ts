import type { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager, Repository } from 'typeorm';

import type { Customer } from '../customer/schema/customer.entity';
import {
  CustomerClaimEligibilityReason,
  type CustomerClaimPolicy,
} from './customer-claim.policy';
import {
  LocalCustomerClaimResult,
  LocalCustomerClaimService,
} from './local-customer-claim.service';

describe('LocalCustomerClaimService', () => {
  let enabled: boolean;
  let repository: {
    createQueryBuilder: jest.Mock;
    save: jest.Mock;
  };
  let transaction: jest.Mock;
  let evaluateCustomer: jest.Mock;
  let service: LocalCustomerClaimService;

  beforeEach(() => {
    enabled = true;
    repository = {
      createQueryBuilder: jest.fn(),
      save: jest.fn((customer: Customer) => Promise.resolve(customer)),
    };
    transaction = jest.fn(
      async (callback: (manager: EntityManager) => Promise<unknown>) =>
        callback({
          getRepository: () => repository as unknown as Repository<Customer>,
        } as unknown as EntityManager),
    );
    evaluateCustomer = jest
      .fn()
      .mockReturnValue(CustomerClaimEligibilityReason.ELIGIBLE);
    service = new LocalCustomerClaimService(
      { transaction } as unknown as DataSource,
      {
        get: jest.fn(() => enabled),
      } as unknown as ConfigService,
      { evaluateCustomer } as unknown as CustomerClaimPolicy,
    );
  });

  it('does no database work when the local-only bridge is disabled', async () => {
    enabled = false;

    await expect(service.claimPasswordlessCustomer(input())).resolves.toBe(
      LocalCustomerClaimResult.DISABLED,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('sets the first password without inventing phone verification evidence', async () => {
    const customer = customerFixture({ email: null });
    repository.createQueryBuilder
      .mockReturnValueOnce(queryBuilder(customer))
      .mockReturnValueOnce(queryBuilder(null));

    await expect(service.claimPasswordlessCustomer(input())).resolves.toBe(
      LocalCustomerClaimResult.CLAIMED,
    );
    expect(customer).toMatchObject({
      email: 'counter@example.com',
      passwordHash: 'new-password-hash',
      phoneVerifiedAt: null,
      tokenVersion: 4,
    });
    expect(repository.save).toHaveBeenCalledWith(customer);
  });

  it('never replaces an existing password or mismatched profile email', async () => {
    const configured = customerFixture({ passwordHash: 'existing-hash' });
    repository.createQueryBuilder.mockReturnValueOnce(queryBuilder(configured));
    evaluateCustomer.mockReturnValue(
      CustomerClaimEligibilityReason.PASSWORD_ALREADY_CONFIGURED,
    );

    await expect(service.claimPasswordlessCustomer(input())).resolves.toBe(
      LocalCustomerClaimResult.NOT_ELIGIBLE,
    );
    expect(repository.save).not.toHaveBeenCalled();

    const mismatched = customerFixture({ email: 'other@example.com' });
    repository.createQueryBuilder.mockReset();
    repository.createQueryBuilder.mockReturnValueOnce(queryBuilder(mismatched));
    evaluateCustomer.mockReturnValue(CustomerClaimEligibilityReason.ELIGIBLE);

    await expect(service.claimPasswordlessCustomer(input())).resolves.toBe(
      LocalCustomerClaimResult.IDENTITY_CONFLICT,
    );
    expect(repository.save).not.toHaveBeenCalled();
  });
});

function input() {
  return {
    phone: '+84912345678',
    email: 'counter@example.com',
    passwordHash: 'new-password-hash',
  };
}

function customerFixture(overrides: Partial<Customer> = {}): Customer {
  return {
    id: '11',
    fullName: 'Counter Customer',
    email: null,
    phone: '+84912345678',
    passwordHash: null,
    tokenVersion: 3,
    phoneVerifiedAt: null,
    status: 'ACTIVE',
    createdAt: new Date('2026-07-23T07:17:56.087Z'),
    updatedAt: new Date('2026-07-23T07:17:56.087Z'),
    deletedAt: null,
    ...overrides,
  };
}

function queryBuilder(result: Customer | null) {
  const builder = {
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    setLock: jest.fn(),
    getOne: jest.fn().mockResolvedValue(result),
  };
  builder.addSelect.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.andWhere.mockReturnValue(builder);
  builder.setLock.mockReturnValue(builder);
  return builder;
}
