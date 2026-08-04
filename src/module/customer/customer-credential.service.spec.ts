import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

import { AppHttpException, ErrorCode } from '../../common/http';
import type { PasswordHasherService } from '../auth/password-hasher.service';
import type { CustomerCredentialPolicy } from './customer-credential.policy';
import { CustomerCredentialService } from './customer-credential.service';
import { Customer } from './schema/customer.entity';

describe('CustomerCredentialService', () => {
  let customer: Customer | null;
  let save: jest.Mock;
  let queryBuilder: ReturnType<typeof createLockedQueryBuilder>;
  let dataSource: {
    transaction: jest.Mock;
  };
  let passwordHasher: {
    verify: jest.Mock;
    hash: jest.Mock;
  };
  let credentialPolicy: {
    evaluate: jest.Mock;
  };
  let service: CustomerCredentialService;

  beforeEach(() => {
    customer = customerFixture();
    save = jest.fn((value: Customer) => Promise.resolve(value));
    queryBuilder = createLockedQueryBuilder(() => customer);
    const manager = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => queryBuilder),
        save,
      })),
    } as unknown as EntityManager;
    dataSource = {
      transaction: jest.fn((work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
      ),
    };
    passwordHasher = {
      verify: jest.fn(),
      hash: jest.fn(),
    };
    credentialPolicy = {
      evaluate: jest.fn((value: Customer | null) => ({
        canSetInitialPassword: value?.passwordHash === null,
        reasonCode:
          value?.passwordHash === null
            ? null
            : ErrorCode.CUSTOMER_INITIAL_PASSWORD_ALREADY_CONFIGURED,
      })),
    };
    service = new CustomerCredentialService(
      dataSource as unknown as DataSource,
      passwordHasher as unknown as PasswordHasherService,
      credentialPolicy as unknown as CustomerCredentialPolicy,
    );
  });

  it('changes the current password atomically and revokes old tokens', async () => {
    passwordHasher.verify
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    passwordHasher.hash.mockResolvedValue('new-password-hash');

    await expect(
      service.changeOwnPassword('10', {
        currentPassword: 'CurrentPassword123!',
        newPassword: 'NewPassword456!',
      }),
    ).resolves.toEqual({ passwordConfigured: true });

    expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(customer).toMatchObject({
      passwordHash: 'new-password-hash',
      tokenVersion: 1,
    });
    expect(save).toHaveBeenCalledWith(customer);
  });

  it.each([
    {
      name: 'missing token customer id',
      arrange: () => undefined,
      id: undefined,
      error: UnauthorizedException,
    },
    {
      name: 'deleted or missing customer',
      arrange: () => {
        customer = null;
      },
      id: '10',
      error: UnauthorizedException,
    },
    {
      name: 'locked customer after guard',
      arrange: () => {
        customer = customerFixture({ status: 'LOCKED' });
      },
      id: '10',
      error: ForbiddenException,
    },
    {
      name: 'wrong current password',
      arrange: () => {
        passwordHasher.verify.mockResolvedValue(false);
      },
      id: '10',
      error: AppHttpException,
    },
    {
      name: 'same new password',
      arrange: () => {
        passwordHasher.verify.mockResolvedValue(true);
      },
      id: '10',
      error: AppHttpException,
    },
  ])('rejects password change for $name', async ({ arrange, id, error }) => {
    arrange();

    await expect(
      service.changeOwnPassword(id, {
        currentPassword: 'CurrentPassword123!',
        newPassword: 'NewPassword456!',
      }),
    ).rejects.toBeInstanceOf(error);
    expect(save).not.toHaveBeenCalled();
  });

  it('sets the first password under a pessimistic lock', async () => {
    customer = customerFixture({ passwordHash: null, tokenVersion: 4 });
    passwordHasher.hash.mockResolvedValue('initial-password-hash');

    await expect(
      service.setInitialPassword('10', {
        password: 'InitialPassword123!',
      }),
    ).resolves.toEqual({ passwordConfigured: true });
    expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(customer).toMatchObject({
      passwordHash: 'initial-password-hash',
      tokenVersion: 5,
    });
  });

  it('rejects initial password when customer is missing or already configured', async () => {
    customer = null;
    await expect(
      service.setInitialPassword('10', {
        password: 'InitialPassword123!',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    customer = customerFixture();
    await expect(
      service.setInitialPassword('10', {
        password: 'InitialPassword123!',
      }),
    ).rejects.toHaveProperty(
      'response.errorCode',
      ErrorCode.CUSTOMER_INITIAL_PASSWORD_ALREADY_CONFIGURED,
    );
  });

  it('validates management customer id before opening a transaction', async () => {
    await expect(
      service.setInitialPassword('bad-id', {
        password: 'InitialPassword123!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});

function createLockedQueryBuilder(getCustomer: () => Customer | null) {
  const queryBuilder = {
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    setLock: jest.fn(),
    getOne: jest.fn(() => Promise.resolve(getCustomer())),
  };

  queryBuilder.addSelect.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue(queryBuilder);
  queryBuilder.andWhere.mockReturnValue(queryBuilder);
  queryBuilder.setLock.mockReturnValue(queryBuilder);

  return queryBuilder;
}

function customerFixture(overrides: Partial<Customer> = {}): Customer {
  return {
    id: '10',
    fullName: 'Customer',
    email: 'customer@example.com',
    phone: '+84705840355',
    passwordHash: 'password-hash',
    tokenVersion: 0,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}
