import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { ErrorCode } from '../../common/http';
import { CustomerAdminService } from './customer-admin.service';
import { Customer } from './schema/customer.entity';

describe('CustomerAdminService', () => {
  let repository: {
    createQueryBuilder: jest.Mock;
    findOneBy: jest.Mock;
    save: jest.Mock;
  };
  let service: CustomerAdminService;
  const credentialPolicy = {
    evaluate: jest.fn((customer: Customer | null) => ({
      canSetInitialPassword: customer?.passwordHash === null,
      reasonCode:
        customer === null
          ? ErrorCode.COMMON_NOT_FOUND
          : customer.passwordHash === null
            ? null
            : ErrorCode.CUSTOMER_INITIAL_PASSWORD_ALREADY_CONFIGURED,
    })),
    evaluateByCustomerId: jest.fn(),
  };

  beforeEach(() => {
    repository = {
      createQueryBuilder: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn((value: Customer) => Promise.resolve(value)),
    };
    credentialPolicy.evaluate.mockClear();
    credentialPolicy.evaluateByCustomerId.mockReset();
    credentialPolicy.evaluateByCustomerId.mockResolvedValue({
      canSetInitialPassword: false,
      reasonCode: ErrorCode.CUSTOMER_INITIAL_PASSWORD_ALREADY_CONFIGURED,
    });
    service = new CustomerAdminService(
      repository as unknown as Repository<Customer>,
      credentialPolicy as never,
    );
  });

  it('lists customers with pagination, search and status', async () => {
    const queryBuilder = createListQueryBuilder([[customerFixture()], 21]);
    repository.createQueryBuilder.mockReturnValue(queryBuilder);

    await expect(
      service.listCustomers({
        page: '2',
        limit: '10',
        search: ' customer ',
        status: 'ACTIVE',
      }),
    ).resolves.toMatchObject({
      items: [
        {
          id: '10',
          status: 'ACTIVE',
          credentialCapabilities: {
            canSetInitialPassword: false,
            reasonCode: ErrorCode.CUSTOMER_INITIAL_PASSWORD_ALREADY_CONFIGURED,
          },
        },
      ],
      meta: {
        pagination: { page: 2, limit: 10, total: 21, totalPages: 3 },
      },
    });
    expect(queryBuilder.skip).toHaveBeenCalledWith(10);
    expect(queryBuilder.take).toHaveBeenCalledWith(10);
    expect(queryBuilder.addSelect).toHaveBeenCalledWith(
      'customer.passwordHash',
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'customer.status = :status',
      { status: 'ACTIVE' },
    );
  });

  it('increments tokenVersion on each real status transition', async () => {
    const customer = customerFixture({ tokenVersion: 2 });
    repository.findOneBy.mockResolvedValue(customer);

    await service.updateStatus('10', 'LOCKED');
    expect(customer).toMatchObject({ status: 'LOCKED', tokenVersion: 3 });

    await service.updateStatus('10', 'ACTIVE');
    expect(customer).toMatchObject({ status: 'ACTIVE', tokenVersion: 4 });
  });

  it('keeps tokenVersion for an idempotent status request', async () => {
    const customer = customerFixture({ tokenVersion: 2 });
    repository.findOneBy.mockResolvedValue(customer);

    await service.updateStatus('10', 'ACTIVE');

    expect(customer.tokenVersion).toBe(2);
  });

  it('rejects invalid and missing customer ids', async () => {
    await expect(
      service.updateStatus('bad-id', 'ACTIVE'),
    ).rejects.toBeInstanceOf(BadRequestException);

    repository.findOneBy.mockResolvedValue(null);
    await expect(service.updateStatus('999', 'ACTIVE')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

function createListQueryBuilder(result: [Customer[], number]) {
  const queryBuilder = {
    addSelect: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    andWhere: jest.fn(),
    getManyAndCount: jest.fn().mockResolvedValue(result),
  };

  queryBuilder.addSelect.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue(queryBuilder);
  queryBuilder.orderBy.mockReturnValue(queryBuilder);
  queryBuilder.skip.mockReturnValue(queryBuilder);
  queryBuilder.take.mockReturnValue(queryBuilder);
  queryBuilder.andWhere.mockReturnValue(queryBuilder);

  return queryBuilder;
}

function customerFixture(overrides: Partial<Customer> = {}): Customer {
  return {
    id: '10',
    fullName: 'E2E Customer',
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
