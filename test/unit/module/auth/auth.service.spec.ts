import { Logger, UnauthorizedException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { Repository } from 'typeorm';

import type { Customer } from '../../../../src/module/customer/schema/customer.entity';
import type { User } from '../../../../src/module/user/schema/user.entity';
import type { AccessTokenService } from '../../../../src/module/auth/access-token.service';
import { AuthService } from '../../../../src/module/auth/auth.service';
import type { PasswordHasherService } from '../../../../src/module/auth/password-hasher.service';
import {
  LocalCustomerClaimResult,
  type LocalCustomerClaimService,
} from '../../../../src/module/auth/local-customer-claim.service';

describe('AuthService', () => {
  let customersRepository: {
    findOneBy: jest.Mock;
    createQueryBuilder: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let usersRepository: {
    findOneBy: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let passwordHasherService: {
    hash: jest.Mock;
    verify: jest.Mock;
    verifyOrDummy: jest.Mock;
  };
  let accessTokenService: {
    sign: jest.Mock;
    getExpiresInSeconds: jest.Mock;
  };
  let localCustomerClaimService: {
    claimPasswordlessCustomer: jest.Mock;
  };
  let service: AuthService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    customersRepository = {
      findOneBy: jest.fn(),
      createQueryBuilder: jest.fn(),
      create: jest.fn((value: Customer) => value),
      save: jest.fn(),
    };
    usersRepository = {
      findOneBy: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    passwordHasherService = {
      hash: jest.fn(),
      verify: jest.fn(),
      verifyOrDummy: jest.fn(),
    };
    accessTokenService = {
      sign: jest.fn(),
      getExpiresInSeconds: jest.fn().mockReturnValue(900),
    };
    localCustomerClaimService = {
      claimPasswordlessCustomer: jest
        .fn()
        .mockResolvedValue(LocalCustomerClaimResult.DISABLED),
    };
    service = new AuthService(
      customersRepository as unknown as Repository<Customer>,
      usersRepository as unknown as Repository<User>,
      passwordHasherService as unknown as PasswordHasherService,
      accessTokenService as unknown as AccessTokenService,
      localCustomerClaimService as unknown as LocalCustomerClaimService,
    );
  });

  it('normalizes customer registration before uniqueness checks and persistence', async () => {
    customersRepository.findOneBy.mockResolvedValue(null);
    customersRepository.createQueryBuilder.mockReturnValue(
      createQueryBuilder(null),
    );
    passwordHasherService.hash.mockResolvedValue('password-hash');
    const saved = customerFixture({
      fullName: 'Nguyen Van A',
      email: 'customer@example.com',
      phone: '+84705840355',
      passwordHash: 'password-hash',
    });
    customersRepository.save.mockResolvedValue(saved);

    await expect(
      service.registerCustomer({
        fullName: '  Nguyen Van A  ',
        email: ' CUSTOMER@EXAMPLE.COM ',
        phone: '070 584 0355',
        password: 'StrongPassword123!',
      }),
    ).resolves.toEqual({ accepted: true });

    expect(customersRepository.findOneBy).toHaveBeenCalledWith({
      email: 'customer@example.com',
    });
    expect(passwordHasherService.hash).toHaveBeenCalledWith(
      'StrongPassword123!',
    );
    expect(customersRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: 'Nguyen Van A',
        email: 'customer@example.com',
        phone: '+84705840355',
        passwordHash: 'password-hash',
      }),
    );
  });

  it('rejects a duplicate registration after performing password hashing', async () => {
    customersRepository.findOneBy.mockResolvedValue(customerFixture());
    customersRepository.createQueryBuilder.mockReturnValue(
      createQueryBuilder(null),
    );
    passwordHasherService.hash.mockResolvedValue('unused-password-hash');

    await expect(
      service.registerCustomer({
        fullName: 'Nguyen Van A',
        email: 'customer@example.com',
        phone: '0705840355',
        password: 'StrongPassword123!',
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        statusCode: 409,
        message: 'Khong the dang ky bang email hoac so dien thoai nay.',
      },
    });
    expect(passwordHasherService.hash).toHaveBeenCalledWith(
      'StrongPassword123!',
    );
    expect(customersRepository.save).not.toHaveBeenCalled();
  });

  it('normalizes a duplicate-key registration race to a conflict response', async () => {
    customersRepository.findOneBy.mockResolvedValue(null);
    customersRepository.createQueryBuilder.mockReturnValue(
      createQueryBuilder(null),
    );
    passwordHasherService.hash.mockResolvedValue('password-hash');
    customersRepository.save.mockRejectedValue(
      new QueryFailedError('INSERT', [], {
        code: 'ER_DUP_ENTRY',
        message: "Duplicate entry for key 'customers.UQ_customers_phone'",
      }),
    );

    await expect(
      service.registerCustomer({
        fullName: 'Nguyen Van A',
        email: 'customer@example.com',
        phone: '0705840355',
        password: 'StrongPassword123!',
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        statusCode: 409,
        message: 'Khong the dang ky bang email hoac so dien thoai nay.',
      },
    });
  });

  it('accepts a local claim when the matching Customer has no password', async () => {
    customersRepository.findOneBy.mockResolvedValue(null);
    customersRepository.createQueryBuilder.mockReturnValue(
      createQueryBuilder(customerFixture({ passwordHash: null })),
    );
    passwordHasherService.hash.mockResolvedValue('new-password-hash');
    localCustomerClaimService.claimPasswordlessCustomer.mockResolvedValue(
      LocalCustomerClaimResult.CLAIMED,
    );

    await expect(
      service.registerCustomer({
        fullName: 'Counter Customer',
        email: 'customer@example.com',
        phone: '0705840355',
        password: 'StrongPassword123!',
      }),
    ).resolves.toEqual({ accepted: true });
    expect(
      localCustomerClaimService.claimPasswordlessCustomer,
    ).toHaveBeenCalledWith({
      phone: '+84705840355',
      email: 'customer@example.com',
      passwordHash: 'new-password-hash',
    });
    expect(customersRepository.save).not.toHaveBeenCalled();
  });

  it('logs a customer in by normalized phone and signs the DB tokenVersion', async () => {
    const queryBuilder = createQueryBuilder(
      customerFixture({ tokenVersion: 5 }),
    );
    customersRepository.createQueryBuilder.mockReturnValue(queryBuilder);
    passwordHasherService.verifyOrDummy.mockResolvedValue(true);
    accessTokenService.sign.mockReturnValue('customer-token');

    await expect(
      service.loginCustomer({
        identifier: '070 584 0355',
        password: 'StrongPassword123!',
      }),
    ).resolves.toMatchObject({
      accessToken: 'customer-token',
      tokenType: 'Bearer',
      expiresIn: 900,
      actorType: 'customer',
      customer: { id: 'customer-1' },
    });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(LOWER(customer.email) = :email OR customer.phone IN (:...phones))',
      {
        email: '+84705840355',
        phones: ['+84705840355', '0705840355', '84705840355'],
      },
    );
    expect(accessTokenService.sign).toHaveBeenCalledWith({
      actorType: 'customer',
      customerId: 'customer-1',
      tokenVersion: 5,
    });
  });

  it.each([
    {
      name: 'missing account',
      customer: null,
      passwordMatches: false,
      expectedHash: null,
    },
    {
      name: 'locked account',
      customer: customerFixture({ status: 'LOCKED' }),
      passwordMatches: true,
      expectedHash: 'password-hash',
    },
    {
      name: 'account without a password',
      customer: customerFixture({ passwordHash: null }),
      passwordMatches: false,
      expectedHash: null,
    },
    {
      name: 'wrong password',
      customer: customerFixture(),
      passwordMatches: false,
      expectedHash: 'password-hash',
    },
  ])(
    'uses the same customer login failure for $name after password verification',
    async ({ customer, passwordMatches, expectedHash }) => {
      customersRepository.createQueryBuilder.mockReturnValue(
        createQueryBuilder(customer),
      );
      passwordHasherService.verifyOrDummy.mockResolvedValue(passwordMatches);

      await expect(
        service.loginCustomer({
          identifier: 'customer@example.com',
          password: 'StrongPassword123!',
        }),
      ).rejects.toMatchObject({
        status: 401,
        response: {
          statusCode: 401,
          message: 'Thong tin dang nhap khong hop le.',
        },
      });
      expect(passwordHasherService.verifyOrDummy).toHaveBeenCalledWith(
        'StrongPassword123!',
        expectedHash,
      );
      expect(accessTokenService.sign).not.toHaveBeenCalled();
    },
  );

  it('logs a user in with the current role and tokenVersion from DB', async () => {
    usersRepository.createQueryBuilder.mockReturnValue(
      createQueryBuilder(userFixture({ role: 'ADMIN', tokenVersion: 7 })),
    );
    passwordHasherService.verifyOrDummy.mockResolvedValue(true);
    accessTokenService.sign.mockReturnValue('user-token');

    await expect(
      service.loginUser({
        identifier: ' ADMIN@EXAMPLE.COM ',
        password: 'StrongPassword123!',
      }),
    ).resolves.toMatchObject({
      accessToken: 'user-token',
      actorType: 'user',
      user: { id: 'user-1', role: 'ADMIN' },
    });
    expect(accessTokenService.sign).toHaveBeenCalledWith({
      actorType: 'user',
      userId: 'user-1',
      role: 'ADMIN',
      tokenVersion: 7,
    });
  });

  it.each([
    {
      name: 'missing account',
      user: null,
      passwordMatches: false,
      expectedHash: null,
    },
    {
      name: 'locked account',
      user: userFixture({ status: 'LOCKED' }),
      passwordMatches: true,
      expectedHash: 'password-hash',
    },
    {
      name: 'wrong password',
      user: userFixture(),
      passwordMatches: false,
      expectedHash: 'password-hash',
    },
  ])(
    'uses the same user login failure for $name after password verification',
    async ({ user, passwordMatches, expectedHash }) => {
      usersRepository.createQueryBuilder.mockReturnValue(
        createQueryBuilder(user),
      );
      passwordHasherService.verifyOrDummy.mockResolvedValue(passwordMatches);

      await expect(
        service.loginUser({
          identifier: 'admin@example.com',
          password: 'WrongPassword123!',
        }),
      ).rejects.toMatchObject({
        status: 401,
        response: {
          statusCode: 401,
          message: 'Thong tin dang nhap khong hop le.',
        },
      });
      expect(passwordHasherService.verifyOrDummy).toHaveBeenCalledWith(
        'WrongPassword123!',
        expectedHash,
      );
      expect(accessTokenService.sign).not.toHaveBeenCalled();
    },
  );

  it('reads the current account for /auth/me and rejects a locked account', async () => {
    customersRepository.findOneBy.mockResolvedValue(
      customerFixture({ status: 'LOCKED' }),
    );

    await expect(
      service.getMe({
        sub: 'customer:customer-1',
        actor_type: 'customer',
        customer_id: 'customer-1',
        token_version: 0,
        iat: 100,
        exp: 200,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

function createQueryBuilder(result: Customer | User | null) {
  const queryBuilder = {
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    getOne: jest.fn().mockResolvedValue(result),
  };

  queryBuilder.addSelect.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue(queryBuilder);
  queryBuilder.andWhere.mockReturnValue(queryBuilder);

  return queryBuilder;
}

function customerFixture(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-1',
    fullName: 'Nguyen Van A',
    email: 'customer@example.com',
    phone: '+84705840355',
    passwordHash: 'password-hash',
    tokenVersion: 0,
    phoneVerifiedAt: null,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function userFixture(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    fullName: 'Admin',
    email: 'admin@example.com',
    phone: '+84912345678',
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
