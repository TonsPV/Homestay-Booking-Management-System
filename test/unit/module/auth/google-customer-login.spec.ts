import { AppHttpException } from '../../../../src/common/http/app-http-exception';
import { ErrorCode } from '../../../../src/common/error-codes';
import { AuthService } from '../../../../src/module/auth/auth.service';
import type { AccessTokenService } from '../../../../src/module/auth/access-token.service';
import type { CustomerAuthIdentity } from '../../../../src/module/auth/schema/customer-auth-identity.entity';
import type { GoogleIdentityVerifier } from '../../../../src/module/auth/google-identity.verifier';
import type { PasswordHasherService } from '../../../../src/module/auth/password-hasher.service';
import type { Customer } from '../../../../src/module/customer/schema/customer.entity';

function customerFixture(overrides: Partial<Customer> = {}): Customer {
  return {
    id: '42',
    fullName: 'Google Guest',
    email: 'guest@example.com',
    phone: '+84901234567',
    passwordHash: null,
    tokenVersion: 0,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('AuthService Google customer login', () => {
  function createService() {
    const customerRepo = {
      findOneBy: jest.fn(),
      createQueryBuilder: jest.fn(),
      create: jest.fn((value: Customer) => value),
      save: jest.fn(),
      manager: { transaction: jest.fn() },
    };
    const userRepo = {
      findOneBy: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    const passwordHasher = {} as PasswordHasherService;
    const sign = jest.fn().mockReturnValue('hbms-token');
    const tokenService = {
      sign,
      getExpiresInSeconds: jest.fn().mockReturnValue(3600),
    } as unknown as AccessTokenService;
    const identityRepo = {
      findOneBy: jest.fn(),
    };
    const verifier = {
      isEnabled: jest.fn().mockReturnValue(true),
      verify: jest.fn().mockResolvedValue({
        email: 'guest@example.com',
        emailVerified: true,
        fullName: 'Google Guest',
        subject: 'google-subject-1',
      }),
    };

    const service = new AuthService(
      customerRepo as never,
      userRepo as never,
      passwordHasher,
      tokenService,
      identityRepo as unknown as import('typeorm').Repository<CustomerAuthIdentity>,
      verifier as unknown as GoogleIdentityVerifier,
    );

    return { customerRepo, identityRepo, service, sign, verifier };
  }

  it('signs in an existing linked identity without requiring the phone again', async () => {
    const { customerRepo, identityRepo, service, sign } = createService();
    identityRepo.findOneBy.mockResolvedValue({ customerId: '42' });
    customerRepo.findOneBy.mockResolvedValue(customerFixture());

    await expect(
      service.loginCustomerWithGoogle({ credential: 'google-token' }),
    ).resolves.toMatchObject({
      accessToken: 'hbms-token',
      actorType: 'customer',
      customer: { id: '42' },
    });
    expect(sign).toHaveBeenCalledWith({
      actorType: 'customer',
      customerId: '42',
      tokenVersion: 0,
    });
  });

  it('requires a phone before creating a new customer identity', async () => {
    const { customerRepo, identityRepo, service } = createService();
    identityRepo.findOneBy.mockResolvedValue(null);
    const queryBuilder = {
      withDeleted: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    customerRepo.createQueryBuilder.mockReturnValue(queryBuilder);

    const error = await service
      .loginCustomerWithGoogle({ credential: 'google-token' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppHttpException);
    expect((error as AppHttpException).getStatus()).toBe(400);
    expect((error as AppHttpException).getResponse()).toMatchObject({
      errorCode: ErrorCode.AUTH_GOOGLE_PHONE_REQUIRED,
    });
    expect(customerRepo.manager.transaction).not.toHaveBeenCalled();
  });

  it('creates the customer and Google identity in one transaction', async () => {
    const { customerRepo, identityRepo, service, sign, verifier } =
      createService();
    identityRepo.findOneBy.mockResolvedValue(null);
    verifier.verify.mockResolvedValue({
      email: 'new-guest@example.com',
      emailVerified: true,
      fullName: 'New Google Guest',
      subject: 'google-subject-new',
    });
    customerRepo.createQueryBuilder.mockReturnValue({
      withDeleted: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    });

    const savedCustomer = customerFixture({
      email: 'new-guest@example.com',
      fullName: 'New Google Guest',
      id: '43',
      phone: '+84901234567',
    });
    const transactionIdentityRepo = {
      create: jest.fn((value: unknown) => value),
      save: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn().mockReturnValue({
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
      }),
    };
    const transactionCustomerRepo = {
      create: jest.fn((value: unknown) => value),
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce({
          getOne: jest.fn().mockResolvedValue(null),
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          withDeleted: jest.fn().mockReturnThis(),
        })
        .mockReturnValueOnce({
          getOne: jest.fn().mockResolvedValue(null),
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          withDeleted: jest.fn().mockReturnThis(),
        }),
      findOneBy: jest.fn(),
      save: jest.fn().mockResolvedValue(savedCustomer),
    };
    const manager = {
      getRepository: jest
        .fn()
        .mockReturnValueOnce(transactionIdentityRepo)
        .mockReturnValueOnce(transactionCustomerRepo),
    };
    customerRepo.manager.transaction.mockImplementation(
      async (callback: (value: typeof manager) => Promise<unknown>) =>
        callback(manager),
    );

    await expect(
      service.loginCustomerWithGoogle({
        credential: 'google-token',
        phone: '0901234567',
      }),
    ).resolves.toMatchObject({
      actorType: 'customer',
      customer: { email: 'new-guest@example.com', id: '43' },
    });
    expect(transactionCustomerRepo.create).toHaveBeenCalledWith({
      email: 'new-guest@example.com',
      fullName: 'New Google Guest',
      passwordHash: null,
      phone: '+84901234567',
      status: 'ACTIVE',
    });
    expect(transactionIdentityRepo.create).toHaveBeenCalledWith({
      customerId: '43',
      provider: 'google',
      providerSubject: 'google-subject-new',
    });
    expect(sign).toHaveBeenCalledWith({
      actorType: 'customer',
      customerId: '43',
      tokenVersion: 0,
    });
  });

  it('does not auto-link a Google identity to an existing email account', async () => {
    const { customerRepo, identityRepo, service } = createService();
    identityRepo.findOneBy.mockResolvedValue(null);
    customerRepo.createQueryBuilder.mockReturnValue({
      withDeleted: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(customerFixture({ id: '99' })),
    });

    const error = await service
      .loginCustomerWithGoogle({
        credential: 'google-token',
        phone: '0901234567',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppHttpException);
    expect((error as AppHttpException).getStatus()).toBe(409);
    expect((error as AppHttpException).getResponse()).toMatchObject({
      errorCode: ErrorCode.AUTH_GOOGLE_ACCOUNT_CONFLICT,
    });
    expect(customerRepo.manager.transaction).not.toHaveBeenCalled();
  });
});
