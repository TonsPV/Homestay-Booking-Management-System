import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { ErrorCode } from '../../../../src/common/error-codes';
import { AuditActorType } from '../../../../src/module/audit/domain/audit-log';
import { CustomerAdminService } from '../../../../src/module/customer/customer-admin.service';
import { Customer } from '../../../../src/module/customer/schema/customer.entity';

describe('CustomerAdminService', () => {
  let repository: {
    createQueryBuilder: jest.Mock;
    save: jest.Mock;
    manager: {
      transaction: jest.Mock;
    };
  };
  let txRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let transactionManager: {
    getRepository: jest.Mock;
  };
  let service: CustomerAdminService;
  const auditLogService = { record: jest.fn() };
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
  };
  const credentialLookup = {
    getCapabilitiesByCustomerId: jest.fn(),
  };

  beforeEach(() => {
    txRepo = {
      findOne: jest.fn(),
      save: jest.fn((value: Customer) => Promise.resolve(value)),
    };
    transactionManager = {
      getRepository: jest.fn().mockReturnValue(txRepo),
    };
    repository = {
      createQueryBuilder: jest.fn(),
      save: jest.fn((value: Customer) => Promise.resolve(value)),
      manager: {
        transaction: jest.fn((operation: (value: unknown) => unknown) =>
          operation(transactionManager),
        ),
      },
    };
    credentialPolicy.evaluate.mockClear();
    credentialLookup.getCapabilitiesByCustomerId.mockReset();
    credentialLookup.getCapabilitiesByCustomerId.mockResolvedValue({
      canSetInitialPassword: false,
      reasonCode: ErrorCode.CUSTOMER_INITIAL_PASSWORD_ALREADY_CONFIGURED,
    });
    auditLogService.record.mockReset();
    auditLogService.record.mockResolvedValue(undefined);
    service = new CustomerAdminService(
      repository as unknown as Repository<Customer>,
      credentialPolicy,
      credentialLookup as never,
      auditLogService,
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
    txRepo.findOne.mockResolvedValue(customer);

    await service.updateStatus('10', 'LOCKED');
    expect(customer).toMatchObject({ status: 'LOCKED', tokenVersion: 3 });

    await service.updateStatus('10', 'ACTIVE');
    expect(customer).toMatchObject({ status: 'ACTIVE', tokenVersion: 4 });
  });

  it('keeps tokenVersion for an idempotent status request', async () => {
    const customer = customerFixture({ tokenVersion: 2 });
    txRepo.findOne.mockResolvedValue(customer);

    await service.updateStatus('10', 'ACTIVE');

    expect(customer.tokenVersion).toBe(2);
    expect(txRepo.findOne).toHaveBeenCalledWith({
      where: { id: '10' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(txRepo.save).toHaveBeenCalledWith(customer);
    expect(repository.save).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('writes account audit in the same transaction on a real transition', async () => {
    const customer = customerFixture({ tokenVersion: 2 });
    txRepo.findOne.mockResolvedValue(customer);

    await service.updateStatus('10', 'LOCKED', {
      actorType: AuditActorType.USER,
      actorId: '7',
      requestId: 'req-lock',
    });

    expect(repository.manager.transaction).toHaveBeenCalledTimes(1);
    expect(txRepo.findOne).toHaveBeenCalledWith({
      where: { id: '10' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(txRepo.save).toHaveBeenCalledWith(customer);
    expect(repository.save).not.toHaveBeenCalled();
    expect(auditLogService.record).toHaveBeenCalledWith(
      transactionManager,
      expect.objectContaining({
        actorId: '7',
        entityId: '10',
        requestId: 'req-lock',
        metadata: { fromStatus: 'ACTIVE', toStatus: 'LOCKED' },
      }),
    );
  });

  it('preserves the optional audit context behavior for a real transition', async () => {
    const customer = customerFixture({ tokenVersion: 2 });
    txRepo.findOne.mockResolvedValue(customer);

    await service.updateStatus('10', 'LOCKED');

    expect(txRepo.save).toHaveBeenCalledWith(customer);
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('propagates a transaction failure without falling back to a root write', async () => {
    repository.manager.transaction.mockRejectedValue(
      new Error('transaction failed'),
    );

    await expect(service.updateStatus('10', 'LOCKED')).rejects.toThrow(
      'transaction failed',
    );

    expect(txRepo.findOne).not.toHaveBeenCalled();
    expect(txRepo.save).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('propagates an audit failure without a fallback write', async () => {
    const customer = customerFixture({ tokenVersion: 2 });
    txRepo.findOne.mockResolvedValue(customer);
    auditLogService.record.mockRejectedValue(new Error('audit failed'));

    await expect(
      service.updateStatus('10', 'LOCKED', {
        actorType: AuditActorType.USER,
        actorId: '7',
        requestId: 'req-lock',
      }),
    ).rejects.toThrow('audit failed');

    expect(txRepo.save).toHaveBeenCalledWith(customer);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects invalid and missing customer ids', async () => {
    await expect(
      service.updateStatus('bad-id', 'ACTIVE'),
    ).rejects.toBeInstanceOf(BadRequestException);

    txRepo.findOne.mockResolvedValue(null);
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
