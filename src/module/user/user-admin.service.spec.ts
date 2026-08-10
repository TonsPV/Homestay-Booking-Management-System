import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';

import type { AuditActorContext } from '../audit/audit-log.service';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../audit/schema/audit-log.entity';
import type { PasswordHasherService } from '../auth/password-hasher.service';
import { User } from './schema/user.entity';
import { UserAdminService } from './user-admin.service';

describe('UserAdminService', () => {
  let usersRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOneBy: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let passwordHasherService: {
    hash: jest.Mock;
  };
  let auditLogService: { record: jest.Mock };
  let service: UserAdminService;

  beforeEach(() => {
    usersRepository = {
      create: jest.fn((value: User) => value),
      save: jest.fn(),
      findOneBy: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    passwordHasherService = {
      hash: jest.fn(),
    };
    auditLogService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    service = new UserAdminService(
      usersRepository as unknown as Repository<User>,
      passwordHasherService as unknown as PasswordHasherService,
      auditLogService,
    );
  });

  it('creates only an ACTIVE STAFF account with normalized contact data', async () => {
    const emailQuery = createQueryBuilder();
    const phoneQuery = createQueryBuilder();
    usersRepository.createQueryBuilder
      .mockReturnValueOnce(emailQuery)
      .mockReturnValueOnce(phoneQuery);
    passwordHasherService.hash.mockResolvedValue('password-hash');
    usersRepository.save.mockImplementation((user: User) =>
      Promise.resolve(userFixture(user)),
    );

    await expect(
      service.createUser({
        fullName: '  Nguyen Van Staff  ',
        email: ' STAFF@EXAMPLE.COM ',
        phone: '090-123-4567',
        password: 'StrongPassword123!',
        role: 'STAFF',
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
    expect(passwordHasherService.hash).toHaveBeenCalledWith(
      'StrongPassword123!',
    );
  });

  it('rejects issuing ADMIN through create before persistence', async () => {
    await expect(
      service.createUser({
        fullName: 'Escalated Admin',
        email: 'escalated@example.com',
        password: 'StrongPassword123!',
        role: 'ADMIN',
      }),
    ).rejects.toThrow('API nay chi dung de cap tai khoan STAFF.');
    expect(usersRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(usersRepository.save).not.toHaveBeenCalled();
  });

  it('lists users with pagination, search, role and status filters', async () => {
    const queryBuilder = createQueryBuilder({
      manyAndCount: [[userFixture()], 21],
    });
    usersRepository.createQueryBuilder.mockReturnValue(queryBuilder);

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
    usersRepository.findOneBy.mockResolvedValue(userFixture());

    await expect(
      service.updateUser('2', { role: 'ADMIN' }, '1'),
    ).rejects.toThrow('API nay chi dung de cap tai khoan STAFF.');
    expect(usersRepository.save).not.toHaveBeenCalled();
  });

  it('rejects an empty update', async () => {
    usersRepository.findOneBy.mockResolvedValue(userFixture());

    await expect(service.updateUser('2', {}, '1')).rejects.toThrow(
      'Khong co thong tin user de cap nhat.',
    );
    expect(usersRepository.save).not.toHaveBeenCalled();
  });

  it('prevents an ADMIN from demoting itself', async () => {
    usersRepository.findOneBy.mockResolvedValue(
      userFixture({ id: '1', role: 'ADMIN' }),
    );

    await expect(
      service.updateUser('1', { role: 'STAFF' }, '1'),
    ).rejects.toThrow('Admin khong the tu ha quyen');
  });

  it('increments tokenVersion when an admin resets a password', async () => {
    const user = userFixture({ tokenVersion: 4 });
    usersRepository.findOneBy.mockResolvedValue(user);
    passwordHasherService.hash.mockResolvedValue('new-password-hash');
    usersRepository.save.mockImplementation((value: User) =>
      Promise.resolve(value),
    );

    await service.updateUser('2', { password: 'UpdatedPassword456!' }, '1');

    expect(user.passwordHash).toBe('new-password-hash');
    expect(user.tokenVersion).toBe(5);
  });

  it('normalizes update contact data and excludes the current user from unique checks', async () => {
    const user = userFixture();
    const emailQuery = createQueryBuilder();
    const phoneQuery = createQueryBuilder();
    usersRepository.findOneBy.mockResolvedValue(user);
    usersRepository.createQueryBuilder
      .mockReturnValueOnce(emailQuery)
      .mockReturnValueOnce(phoneQuery);
    usersRepository.save.mockImplementation((value: User) =>
      Promise.resolve(value),
    );

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
    usersRepository.findOneBy.mockResolvedValue(userFixture());
    usersRepository.createQueryBuilder.mockReturnValue(
      createQueryBuilder({ one: userFixture({ id: '3' }) }),
    );

    await expect(
      service.updateUser('2', { email: 'other@example.com' }, '1'),
    ).rejects.toBeInstanceOf(ConflictException);

    usersRepository.createQueryBuilder.mockReturnValue(
      createQueryBuilder({ one: userFixture({ id: '3' }) }),
    );
    await expect(
      service.updateUser('2', { phone: '0901234567' }, '1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('revokes existing tokens whenever account status changes', async () => {
    const user = userFixture({ status: 'ACTIVE', tokenVersion: 8 });
    usersRepository.findOneBy.mockResolvedValue(user);
    usersRepository.save.mockImplementation((value: User) =>
      Promise.resolve(value),
    );

    await service.updateStatus('2', 'LOCKED', '1', auditContext());
    expect(user).toMatchObject({ status: 'LOCKED', tokenVersion: 9 });

    await service.updateStatus('2', 'ACTIVE', '1', auditContext());
    expect(user).toMatchObject({ status: 'ACTIVE', tokenVersion: 10 });
  });

  it('does not revoke again for an idempotent status request', async () => {
    const user = userFixture({ status: 'ACTIVE', tokenVersion: 8 });
    const transactionalRepository = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn((value: User) => Promise.resolve(value)),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(transactionalRepository),
    };
    const transaction = jest.fn((operation: (value: unknown) => unknown) =>
      operation(manager),
    );
    Object.assign(usersRepository, { manager: { transaction } });
    service = new UserAdminService(
      usersRepository as unknown as Repository<User>,
      passwordHasherService as unknown as PasswordHasherService,
      auditLogService,
    );

    await service.updateStatus('2', 'ACTIVE', '1', auditContext());

    expect(user.tokenVersion).toBe(8);
    expect(transactionalRepository.findOne).toHaveBeenCalledWith({
      where: { id: '2' },
      lock: { mode: 'pessimistic_write' },
    });
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
      const transactionalRepository = {
        findOne: jest.fn().mockResolvedValue(user),
        save: jest.fn((value: User) => Promise.resolve(value)),
      };
      const manager = {
        getRepository: jest.fn().mockReturnValue(transactionalRepository),
      };
      const transaction = jest.fn((operation: (value: unknown) => unknown) =>
        operation(manager),
      );
      Object.assign(usersRepository, { manager: { transaction } });
      service = new UserAdminService(
        usersRepository as unknown as Repository<User>,
        passwordHasherService as unknown as PasswordHasherService,
        auditLogService,
      );
      const context = auditContext();

      await service.updateStatus('2', toStatus, '1', context);

      expect(user.tokenVersion).toBe(9);
      expect(auditLogService.record).toHaveBeenCalledWith(manager, {
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
    usersRepository.findOneBy.mockResolvedValue(user);
    usersRepository.save.mockImplementation(() =>
      Promise.reject(new Error('save failed')),
    );

    await expect(
      service.updateStatus('2', 'LOCKED', '1', auditContext()),
    ).rejects.toThrow('save failed');

    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('keeps the existing repository save behavior for same-state requests without a manager', async () => {
    const user = userFixture({ status: 'ACTIVE', tokenVersion: 8 });
    usersRepository.findOneBy.mockResolvedValue(user);
    usersRepository.save.mockImplementation((value: User) =>
      Promise.resolve(value),
    );

    await service.updateStatus('2', 'ACTIVE', '1', auditContext());

    expect(user.tokenVersion).toBe(8);
    expect(usersRepository.save).toHaveBeenCalledWith(user);
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('prevents self-lock and rejects invalid or missing ids', async () => {
    usersRepository.findOneBy.mockResolvedValue(
      userFixture({ id: '1', role: 'ADMIN' }),
    );

    await expect(
      service.updateStatus('1', 'LOCKED', '1', auditContext()),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateStatus('bad-id', 'ACTIVE', '1', auditContext()),
    ).rejects.toBeInstanceOf(BadRequestException);

    usersRepository.findOneBy.mockResolvedValue(null);
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
