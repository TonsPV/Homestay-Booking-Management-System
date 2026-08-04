import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp, ErrorCode } from '../src/common/http';
import migrationDataSource from '../src/database/data-source';
import { AccessTokenService } from '../src/module/auth/access-token.service';
import { PasswordHasherService } from '../src/module/auth/password-hasher.service';
import { Customer } from '../src/module/customer/schema/customer.entity';
import { User } from '../src/module/user/schema/user.entity';
import { E2eHarness } from './e2e-harness';

const PASSWORD = 'StrongPassword123!';

interface ResponseEnvelope<TData> {
  success: boolean;
  statusCode: number;
  message: string | string[];
  data: TData;
  meta?: {
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
  path: string;
  timestamp: string;
  requestId: string;
}

interface CustomerPayload {
  id: string;
  fullName: string;
  email: string | null;
  phone: string;
  status: 'ACTIVE' | 'LOCKED';
  credentialCapabilities: {
    canSetInitialPassword: boolean;
    reasonCode: string | null;
  };
}

describe('Customer workflow (e2e)', () => {
  let app: INestApplication<App>;
  let e2eHarness: E2eHarness | undefined;
  let customersRepository: Repository<Customer>;
  let usersRepository: Repository<User>;
  let passwordHasher: PasswordHasherService;
  let accessTokenService: AccessTokenService;
  let admin: User;
  let staff: User;
  let adminToken: string;
  let staffToken: string;
  const createdCustomerIds: string[] = [];
  const createdUserIds: string[] = [];
  const uniqueSuffix = E2eHarness.createUniqueSuffix();
  let fixtureSequence = 0;

  beforeAll(async () => {
    e2eHarness = new E2eHarness(migrationDataSource);
    await e2eHarness.initialize();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    const dataSource = app.get(DataSource);
    customersRepository = dataSource.getRepository(Customer);
    usersRepository = dataSource.getRepository(User);
    passwordHasher = app.get(PasswordHasherService);
    accessTokenService = app.get(AccessTokenService);
    admin = await createDirectUser('ADMIN');
    staff = await createDirectUser('STAFF');
    adminToken = tokenForUser(admin);
    staffToken = tokenForUser(staff);

    e2eHarness.registerCleanup(async () => {
      if (createdCustomerIds.length > 0) {
        await customersRepository.delete([...new Set(createdCustomerIds)]);
      }

      if (createdUserIds.length > 0) {
        await usersRepository.delete([...new Set(createdUserIds)]);
      }
    });
  });

  afterAll(async () => {
    try {
      if (e2eHarness !== undefined) {
        await e2eHarness.cleanup();
      }
    } finally {
      if (app !== undefined) {
        await app.close();
      }
    }
  });

  it('restricts profile ownership and normalizes profile contact updates', async () => {
    const customer = await createCustomer();
    const token = tokenForCustomer(customer);
    const other = await createCustomer();

    const meResponse = await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', 'Bearer ' + token)
      .expect(200);
    expect(
      (meResponse.body as ResponseEnvelope<CustomerPayload>).data,
    ).toMatchObject({
      id: customer.id,
      status: 'ACTIVE',
      phone: customer.phone,
    });

    const nextPhone = nextLocalPhone();
    const updateResponse = await request(app.getHttpServer())
      .patch('/api/v1/customers/me')
      .set('Authorization', 'Bearer ' + token)
      .send({
        fullName: '  Updated Customer  ',
        email: ' ' + nextEmail('updated').toUpperCase() + ' ',
        phone: formatLocalPhone(nextPhone),
      })
      .expect(200);
    const updateBody = updateResponse.body as ResponseEnvelope<CustomerPayload>;
    expect(updateBody.data).toMatchObject({
      id: customer.id,
      fullName: 'Updated Customer',
      phone: '+84' + nextPhone.slice(1),
      status: 'ACTIVE',
    });

    await request(app.getHttpServer())
      .patch('/api/v1/customers/me')
      .set('Authorization', 'Bearer ' + token)
      .send({ email: other.email })
      .expect(409);
    await request(app.getHttpServer())
      .patch('/api/v1/customers/me')
      .set('Authorization', 'Bearer ' + token)
      .send({ phone: other.phone })
      .expect(409);
    await request(app.getHttpServer())
      .patch('/api/v1/customers/me')
      .set('Authorization', 'Bearer ' + token)
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', 'Bearer ' + staffToken)
      .expect(403);
  });

  it('changes customer passwords, revokes old tokens, and protects initial password setup', async () => {
    const customer = await createCustomer();
    const token = tokenForCustomer(customer);
    const changeResponse = await request(app.getHttpServer())
      .patch('/api/v1/customers/me/password')
      .set('Authorization', 'Bearer ' + token)
      .send({
        currentPassword: PASSWORD,
        newPassword: 'NewPassword456!',
      })
      .expect(200);
    expect(
      (changeResponse.body as ResponseEnvelope<{ passwordConfigured: true }>)
        .data,
    ).toEqual({ passwordConfigured: true });

    const changed = await customersRepository.findOneByOrFail({
      id: customer.id,
    });
    expect(changed.tokenVersion).toBe(customer.tokenVersion + 1);
    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', 'Bearer ' + token)
      .expect(401);

    const freshToken = tokenForCustomer(changed);
    const wrongPassword = await request(app.getHttpServer())
      .patch('/api/v1/customers/me/password')
      .set('Authorization', 'Bearer ' + freshToken)
      .send({
        currentPassword: 'WrongPassword456!',
        newPassword: 'AnotherPassword789!',
      })
      .expect(400);
    expect(wrongPassword.body).toMatchObject({
      errorCode: ErrorCode.CUSTOMER_CURRENT_PASSWORD_INVALID,
      fieldErrors: {
        currentPassword: [
          { errorCode: ErrorCode.CUSTOMER_CURRENT_PASSWORD_INVALID },
        ],
      },
    });
    const reusedPassword = await request(app.getHttpServer())
      .patch('/api/v1/customers/me/password')
      .set('Authorization', 'Bearer ' + freshToken)
      .send({
        currentPassword: 'NewPassword456!',
        newPassword: 'NewPassword456!',
      })
      .expect(400);
    expect(reusedPassword.body).toMatchObject({
      errorCode: ErrorCode.CUSTOMER_PASSWORD_REUSE_NOT_ALLOWED,
      fieldErrors: {
        newPassword: [
          { errorCode: ErrorCode.CUSTOMER_PASSWORD_REUSE_NOT_ALLOWED },
        ],
      },
    });

    const passwordless = await createCustomer({ passwordHash: null });
    const customerDenied = await request(app.getHttpServer())
      .patch(
        '/api/v1/management/customers/' + passwordless.id + '/initial-password',
      )
      .set('Authorization', 'Bearer ' + tokenForCustomer(passwordless))
      .send({ password: 'InitialPassword123!' })
      .expect(403);
    expect(customerDenied.body).toMatchObject({
      errorCode: ErrorCode.COMMON_FORBIDDEN,
    });
    await request(app.getHttpServer())
      .patch(
        '/api/v1/management/customers/' + passwordless.id + '/initial-password',
      )
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ password: 'InitialPassword123!' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customers/login')
      .send({ identifier: passwordless.email, password: 'InitialPassword123!' })
      .expect(200);
    const alreadyConfigured = await request(app.getHttpServer())
      .patch(
        '/api/v1/management/customers/' + passwordless.id + '/initial-password',
      )
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ password: 'AnotherPassword789!' })
      .expect(409);
    expect(alreadyConfigured.body).toMatchObject({
      errorCode: ErrorCode.CUSTOMER_INITIAL_PASSWORD_ALREADY_CONFIGURED,
    });

    const concurrent = await createCustomer({ passwordHash: null });
    const initialResponses = await Promise.all([
      setInitialPassword(concurrent.id, 'ConcurrentPassword123!'),
      setInitialPassword(concurrent.id, 'ConcurrentPassword456!'),
    ]);
    expect(initialResponses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
  });

  it('lists customers for ADMIN, transitions status, and revokes customer tokens', async () => {
    await request(app.getHttpServer()).get('/api/v1/customers').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Authorization', 'Bearer ' + staffToken)
      .expect(403);

    const customer = await createCustomer();
    const token = tokenForCustomer(customer);
    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .query({ page: 1, limit: 1, search: customer.email, status: 'ACTIVE' })
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    const listBody = listResponse.body as ResponseEnvelope<CustomerPayload[]>;
    expect(listBody.data).toEqual([
      expect.objectContaining({
        id: customer.id,
        status: 'ACTIVE',
        credentialCapabilities: {
          canSetInitialPassword: false,
          reasonCode: ErrorCode.CUSTOMER_INITIAL_PASSWORD_ALREADY_CONFIGURED,
        },
      }),
    ]);
    expect(listBody.data[0]).not.toHaveProperty('passwordHash');
    expect(listBody.meta?.pagination).toMatchObject({
      total: 1,
      totalPages: 1,
    });

    await request(app.getHttpServer())
      .patch('/api/v1/customers/' + customer.id + '/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: 'LOCKED' })
      .expect(200);
    const locked = await customersRepository.findOneByOrFail({
      id: customer.id,
    });
    expect(locked.tokenVersion).toBe(customer.tokenVersion + 1);
    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', 'Bearer ' + token)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', 'Bearer ' + tokenForCustomer(locked))
      .expect(403);

    await request(app.getHttpServer())
      .patch('/api/v1/customers/' + customer.id + '/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: 'ACTIVE' })
      .expect(200);
    const active = await customersRepository.findOneByOrFail({
      id: customer.id,
    });
    expect(active.tokenVersion).toBe(customer.tokenVersion + 2);
    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', 'Bearer ' + tokenForCustomer(active))
      .expect(200);
    await request(app.getHttpServer())
      .patch('/api/v1/customers/' + customer.id + '/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: 'ACTIVE' })
      .expect(200);
    const idempotent = await customersRepository.findOneByOrFail({
      id: customer.id,
    });
    expect(idempotent.tokenVersion).toBe(active.tokenVersion);

    await request(app.getHttpServer())
      .patch('/api/v1/customers/bad-id/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: 'ACTIVE' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/customers/999999999/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: 'ACTIVE' })
      .expect(404);
  });

  it('rejects stale concurrent profile writes and characterizes status/password concurrency', async () => {
    const profileCustomer = await createCustomer();
    const profileToken = tokenForCustomer(profileCustomer);
    const profileResponses = await Promise.all([
      request(app.getHttpServer())
        .patch('/api/v1/customers/me')
        .set('Authorization', 'Bearer ' + profileToken)
        .send({ fullName: 'Concurrent Profile A' }),
      request(app.getHttpServer())
        .patch('/api/v1/customers/me')
        .set('Authorization', 'Bearer ' + profileToken)
        .send({ fullName: 'Concurrent Profile B' }),
    ]);
    expect(profileResponses.map((response) => response.status).sort()).toEqual([
      200, 200,
    ]);
    const finalProfile = await customersRepository.findOneByOrFail({
      id: profileCustomer.id,
    });
    expect(['Concurrent Profile A', 'Concurrent Profile B']).toContain(
      finalProfile.fullName,
    );

    const mutationCustomer = await createCustomer();
    const mutationToken = tokenForCustomer(mutationCustomer);
    const mutationResponses = await Promise.all([
      request(app.getHttpServer())
        .patch('/api/v1/customers/' + mutationCustomer.id + '/status')
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ status: 'LOCKED' }),
      request(app.getHttpServer())
        .patch('/api/v1/customers/me/password')
        .set('Authorization', 'Bearer ' + mutationToken)
        .send({
          currentPassword: PASSWORD,
          newPassword: 'ConcurrentCustomer456!',
        }),
    ]);
    expect(mutationResponses.map((response) => response.status).sort()).toEqual(
      [200, 200],
    );
    const finalCustomer = await customersRepository.findOneByOrFail({
      id: mutationCustomer.id,
    });
    expect(finalCustomer.status).toBe('LOCKED');
    expect(finalCustomer.tokenVersion).toBe(2);
  });

  async function createDirectUser(role: 'ADMIN' | 'STAFF'): Promise<User> {
    const user = await usersRepository.save(
      usersRepository.create({
        fullName: 'Customer E2E ' + role,
        email: nextEmail('user-' + role),
        phone: null,
        passwordHash: await passwordHasher.hash(PASSWORD),
        tokenVersion: 0,
        role,
        status: 'ACTIVE',
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  async function createCustomer(
    overrides: Partial<Customer> = {},
  ): Promise<Customer> {
    const customer = await customersRepository.save(
      customersRepository.create({
        fullName: 'Customer E2E Fixture ' + nextSequence(),
        email: nextEmail('customer'),
        phone: '+84' + nextLocalPhone().slice(1),
        passwordHash: await passwordHasher.hash(PASSWORD),
        tokenVersion: 0,
        status: 'ACTIVE',
        ...overrides,
      }),
    );
    createdCustomerIds.push(customer.id);
    return customer;
  }

  async function setInitialPassword(
    customerId: string,
    password: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .patch('/api/v1/management/customers/' + customerId + '/initial-password')
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ password });
  }

  function tokenForCustomer(customer: Customer): string {
    return accessTokenService.sign({
      actorType: 'customer',
      customerId: customer.id,
      tokenVersion: customer.tokenVersion,
    });
  }

  function tokenForUser(user: User): string {
    return accessTokenService.sign({
      actorType: 'user',
      userId: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
  }

  function nextSequence(): number {
    fixtureSequence += 1;
    return fixtureSequence;
  }

  function nextEmail(label: string): string {
    return (
      'customer-' +
      label +
      '-' +
      uniqueSuffix +
      '-' +
      nextSequence() +
      '@example.com'
    );
  }

  function nextLocalPhone(): string {
    const phoneSuffix = String(
      (Date.now() + nextSequence()) % 100_000_000,
    ).padStart(8, '0');
    return '09' + phoneSuffix;
  }

  function formatLocalPhone(localPhone: string): string {
    return (
      localPhone.slice(0, 3) +
      ' ' +
      localPhone.slice(3, 6) +
      ' ' +
      localPhone.slice(6)
    );
  }
});
