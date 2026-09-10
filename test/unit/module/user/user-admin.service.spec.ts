import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';

import { UserRoleEnum } from '../../../../src/common/account/account.enums';
import type { AuditActorContext } from '../../../../src/module/audit/audit-log.service';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../../../../src/module/audit/domain/audit-log';
import type { PasswordHasherService } from '../../../../src/module/auth/password-hasher.service';
import { User } from '../../../../src/module/user/schema/user.entity';
import { UserAdminService } from '../../../../src/module/user/user-admin.service';

describe('UserAdminService', () => {
  let userRepo: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
    manager: {
      transaction: jest.Mock;
    };
  };
  let txRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let transactionManager: {
    getRepository: jest.Mock;
  };
  let passwordHasher: {
    hash: jest.Mock;
  };
  let auditLogService: { record: jest.Mock };
  let service: UserAdminService;

  beforeEach(() => {
    txRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    transactionManager = {
      getRepository: jest.fn().mockReturnValue(txRepo),
    };
    userRepo = {
      create: jest.fn((value: User) => value),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
      manager: {
        transaction: jest.fn((operation: (value: unknown) => unknown) =>
          operation(transactionManager),
        ),
      },
    };
    passwordHasher = {
      hash: jest.fn(),
    };
    auditLogService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    service = new UserAdminService(
      userRepo as unknown as Repository<User>,
      passwordHasher as unknown as PasswordHasherService,
      auditLogService,
    );
  });

  it('creates only an ACTIVE STAFF account with normalized contact data', async () => {
    const emailQuery = createQueryBuilder();
    const phoneQuery = createQueryBuilder();
    userRepo.createQueryBuilder
      .mockReturnValueOnce(emailQuery)
      .mockReturnValueOnce(phoneQuery);
    passwordHasher.hash.mockResolvedValue('password-hash');
    userRepo.save.mockImplementation((user: User) =>
      Promise.resolve(userFixture(user)),
    );

    await expect(
      service.createUser({
        fullName: '  Nguyen Van Staff  ',
        email: ' STAFF@EXAMPLE.COM ',
        phone: '090-123-4567',
        password: 'StrongPassword123!',
        role: UserRoleEnum.STAFF,
      }),
    ).resolves.toMatchObject({
      fullName: 'Nguyen Van Staff',
      email: 'staff@example.com',
      phone: '+84901234567',
      role: 'STAFF',
      status: 'ACTIVE',
    });
    expect(phoneQuery.andWhere).toHaveBeenCalledWith(
      'user.phone IN (:...phones)',
      {
        phones: ['+84901234567', '0901234567', '84901234567'],
      },
    );
    expect(passwordHasher.hash).toHaveBeenCalledWith('StrongPassword123!');
  });

  it('rejects issuing ADMIN through create before persistence', async () => {
    await expect(
      service.createUser({
        fullName: 'Escalated Admin',
        email: 'escalated@example.com',
        password: 'StrongPassword123!',
        role: UserRoleEnum.ADMIN,
      }),
    ).rejects.toThrow('API nay chi dung de cap tai khoan STAFF.');
    expect(userRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('lists users with pagination, search, role and status filters', async () => {
    const queryBuilder = createQueryBuilder({
      manyAndCount: [[userFixture()], 21],
    });
    userRepo.createQueryBuilder.mockReturnValue(queryBuilder);

    await expect(
      service.listUsers({
        page: '2',
        limit: '10',
        search: ' Staff ',
        role: 'STAFF',
        status: 'ACTIVE',
      }),
    ).resolves.toMatchObject({
      items: [{ id: '2', role: 'STAFF', status: 'ACTIVE' }],
      meta: {
        pagination: { page: 2, limit: 10, total: 21, totalPages: 3 },
      },
    });
    expect(queryBuilder.skip).toHaveBeenCalledWith(10);
    expect(queryBuilder.take).toHaveBeenCalledWith(10);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('user.role = :role', {
      role: 'STAFF',
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'user.status = :status',
      { status: 'ACTIVE' },
    );
  });

  it('rejects promotion to ADMIN through update', async () => {
    txRepo.findOne.mockResolvedValue(userFixture());

    await expect(
      service.updateUser('2', { role: UserRoleEnum.ADMIN }, '1'),
    ).rejects.toThrow('API nay chi dung de cap tai khoan STAFF.');
    expect(txRepo.save).not.toHaveBeenCalled();
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('rejects an empty update', async () => {
    txRepo.findOne.mockResolvedValue(userFixture());

    await expect(service.updateUser('2', {}, '1')).rejects.toThrow(
      'Khong co thong tin user de cap nhat.',
    );
    expect(txRepo.save).not.toHaveBeenCalled();
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('prevents an ADMIN from demoting itself', async () => {
    txRepo.findOne.mockResolvedValue(userFixture({ id: '1', role: 'ADMIN' }));

    await expect(
      service.updateUser('1', { role: UserRoleEnum.STAFF }, '1'),
    ).rejects.toThrow('Admin khong the tu ha quyen');
  });

  it('increments tokenVersion when an admin resets a password', async () => {
    const user = userFixture({ tokenVersion: 4 });
    txRepo.findOne.mockResolvedValue(user);
    passwordHasher.hash.mockResolvedValue('new-password-hash');
    txRepo.save.mockImplementation((value: User) => Promise.resolve(value));

    await service.updateUser('2', { password: 'UpdatedPassword456!' }, '1');

    expect(user.passwordHash).toBe('new-password-hash');
    expect(user.tokenVersion).toBe(5);
  });

  it('normalizes update contact data and excludes the current user from unique checks', async () => {
    const user = userFixture();
    const emailQuery = createQueryBuilder();
    const phoneQuery = createQueryBuilder();
    txRepo.findOne.mockResolvedValue(user);
    txRepo.createQueryBuilder
      .mockReturnValueOnce(emailQuery)
      .mockReturnValueOnce(phoneQuery);
    txRepo.save.mockImplementation((value: User) => Promise.resolve(value));

    await service.updateUser(
      '2',
      {
        email: ' UPDATED@EXAMPLE.COM ',
        phone: '091 234 5678',
      },
      '1',
    );

    expect(user.email).toBe('updated@example.com');
    expect(user.phone).toBe('+84912345678');
    expect(emailQuery.andWhere).toHaveBeenCalledWith(
      'user.id <> :currentUserId',
      { currentUserId: '2' },
    );
    expect(phoneQuery.andWhere).toHaveBeenCalledWith(
      'user.id <> :currentUserId',
      { currentUserId: '2' },
    );
  });

  it('rejects duplicate email and phone values', async () => {
    txRepo.findOne.mockResolvedValue(userFixture());
    txRepo.createQueryBuilder.mockReturnValue(
      createQueryBuilder({ one: userFixture({ id: '3' }) }),
    );

    await expect(
      service.updateUser('2', { email: 'other@example.com' }, '1'),
    ).rejects.toBeInstanceOf(ConflictException);

    txRepo.createQueryBuilder.mockReturnValue(
      createQueryBuilder({ one: userFixture({ id: '3' }) }),
    );
    await expect(
      service.updateUser('2', { phone: '0901234567' }, '1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('revokes existing tokens whenever account status changes', async () => {
    const user = userFixture({ status: 'ACTIVE', tokenVersion: 8 });
    txRepo.findOne.mockResolvedValue(user);
    txRepo.save.mockImplementation((value: User) => Promise.resolve(value));

    await service.updateStatus('2', 'LOCKED', '1', auditContext());
    expect(user).toMatchObject({ status: 'LOCKED', tokenVersion: 9 });

    await service.updateStatus('2', 'ACTIVE', '1', auditContext());
    expect(user).toMatchObject({ status: 'ACTIVE', tokenVersion: 10 });
  });

  it('does not revoke again for an idempotent status request', async () => {
    const user = userFixture({ status: 'ACTIVE', tokenVersion: 8 });
    txRepo.findOne.mockResolvedValue(user);
    txRepo.save.mockImplementation((value: User) => Promise.resolve(value));

    await service.updateStatus('2', 'ACTIVE', '1', auditContext());

    expect(user.tokenVersion).toBe(8);
    expect(userRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(txRepo.findOne).toHaveBeenCalledWith({
      where: { id: '2' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(txRepo.save).toHaveBeenCalledWith(user);
    expect(userRepo.save).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it.each([
    {
      fromStatus: 'ACTIVE',
      toStatus: 'LOCKED',
      action: AuditAction.ACCOUNT_LOCKED,
    },
    {
      fromStatus: 'LOCKED',
      toStatus: 'ACTIVE',
      action: AuditAction.ACCOUNT_UNLOCKED,
    },
  ] as const)(
    'writes $action audit with the status transaction manager',
    async ({ fromStatus, toStatus, action }) => {
      const user = userFixture({ status: fromStatus, tokenVersion: 8 });
      txRepo.findOne.mockResolvedValue(user);
      txRepo.save.mockImplementation((value: User) => Promise.resolve(value));
      const context = auditContext();

      await service.updateStatus('2', toStatus, '1', context);

      expect(user.tokenVersion).toBe(9);
      expect(txRepo.findOne).toHaveBeenCalledWith({
        where: { id: '2' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(txRepo.save).toHaveBeenCalledWith(user);
      expect(userRepo.save).not.toHaveBeenCalled();
      expect(auditLogService.record).toHaveBeenCalledWith(transactionManager, {
        ...context,
        action,
        entityType: AuditEntityType.USER,
        entityId: '2',
        metadata: { fromStatus, toStatus },
      });
    },
  );

  it('does not write audit when status persistence fails', async () => {
    const user = userFixture({ status: 'ACTIVE', tokenVersion: 8 });
    txRepo.findOne.mockResolvedValue(user);
    txRepo.save.mockImplementation(() =>
      Promise.reject(new Error('save failed')),
    );

    await expect(
      service.updateStatus('2', 'LOCKED', '1', auditContext()),
    ).rejects.toThrow('save failed');

    expect(auditLogService.record).not.toHaveBeenCalled();
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('uses the transactional repository for same-state requests', async () => {
    const user = userFixture({ status: 'ACTIVE', tokenVersion: 8 });
    txRepo.findOne.mockResolvedValue(user);
    txRepo.save.mockImplementation((value: User) => Promise.resolve(value));

    await service.updateStatus('2', 'ACTIVE', '1', auditContext());

    expect(user.tokenVersion).toBe(8);
    expect(userRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(txRepo.save).toHaveBeenCalledWith(user);
    expect(userRepo.save).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('propagates a transaction failure without falling back to a root write', async () => {
    userRepo.manager.transaction.mockRejectedValue(
      new Error('transaction failed'),
    );

    await expect(
      service.updateStatus('2', 'LOCKED', '1', auditContext()),
    ).rejects.toThrow('transaction failed');

    expect(txRepo.findOne).not.toHaveBeenCalled();
    expect(txRepo.save).not.toHaveBeenCalled();
    expect(userRepo.save).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('propagates an audit failure without a fallback write', async () => {
    const user = userFixture({ status: 'ACTIVE', tokenVersion: 8 });
    txRepo.findOne.mockResolvedValue(user);
    txRepo.save.mockImplementation((value: User) => Promise.resolve(value));
    auditLogService.record.mockRejectedValue(new Error('audit failed'));

    await expect(
      service.updateStatus('2', 'LOCKED', '1', auditContext()),
    ).rejects.toThrow('audit failed');

    expect(txRepo.save).toHaveBeenCalledWith(user);
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('prevents self-lock and rejects invalid or missing ids', async () => {
    txRepo.findOne.mockResolvedValue(userFixture({ id: '1', role: 'ADMIN' }));

    await expect(
      service.updateStatus('1', 'LOCKED', '1', auditContext()),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateStatus('bad-id', 'ACTIVE', '1', auditContext()),
    ).rejects.toBeInstanceOf(BadRequestException);

    txRepo.findOne.mockResolvedValue(null);
    await expect(
      service.updateStatus('999', 'ACTIVE', '1', auditContext()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

interface QueryBuilderResult {
  one?: User | null;
  manyAndCount?: [User[], number];
}

function createQueryBuilder(result: QueryBuilderResult = {}) {
  const queryBuilder = {
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    getOne: jest.fn().mockResolvedValue(result.one ?? null),
    getManyAndCount: jest
      .fn()
      .mockResolvedValue(result.manyAndCount ?? [[], 0]),
  };

  queryBuilder.where.mockReturnValue(queryBuilder);
  queryBuilder.andWhere.mockReturnValue(queryBuilder);
  queryBuilder.orderBy.mockReturnValue(queryBuilder);
  queryBuilder.skip.mockReturnValue(queryBuilder);
  queryBuilder.take.mockReturnValue(queryBuilder);

  return queryBuilder;
}

function userFixture(overrides: Partial<User> = {}): User {
  return {
    id: '2',
    fullName: 'Nguyen Van Staff',
    email: 'staff@example.com',
    phone: '+84901234567',
    passwordHash: 'password-hash',
    tokenVersion: 0,
    role: 'STAFF',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function auditContext(): AuditActorContext {
  return {
    actorType: AuditActorType.USER,
    actorId: '1',
    requestId: 'request-user-status',
  };
}
