import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/http';
import migrationDataSource from '../src/database/data-source';
import { AccessTokenService } from '../src/module/auth/access-token.service';
import { PasswordHasherService } from '../src/module/auth/password-hasher.service';
import { Customer } from '../src/module/customer/schema/customer.entity';
import { User } from '../src/module/user/schema/user.entity';
import { createOpenApiDocument } from '../src/openapi/openapi';
import { E2eHarness } from './e2e-harness';

const PASSWORD = 'StrongPassword123!';

interface ResponseEnvelope<TData> {
  success: boolean;
  statusCode: number;
  message: string | string[];
  data: TData;
  path: string;
  timestamp: string;
  requestId: string;
}

interface LoginData {
  accessToken: string;
  actorType: 'customer' | 'user';
}

describe('Auth workflow (e2e)', () => {
  let app: INestApplication<App>;
  let e2eHarness: E2eHarness | undefined;
  let customersRepository: Repository<Customer>;
  let usersRepository: Repository<User>;
  let passwordHasher: PasswordHasherService;
  let accessTokenService: AccessTokenService;
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

    e2eHarness.registerCleanup(async () => {
      if (createdCustomerIds.length > 0) {
        await customersRepository.delete(createdCustomerIds);
      }

      if (createdUserIds.length > 0) {
        await usersRepository.delete(createdUserIds);
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

  it('registers, authenticates, revokes, and rejects duplicate customer registration', async () => {
    const localPhone = nextLocalPhone();
    const email = nextEmail('registration');
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customers/register')
      .send({
        fullName: '  Auth E2E Customer  ',
        email: ' ' + email.toUpperCase() + ' ',
        phone: formatLocalPhone(localPhone),
        password: PASSWORD,
      })
      .expect(201);
    const body = response.body as ResponseEnvelope<{ accepted: true }>;

    expect(body).toMatchObject({
      success: true,
      statusCode: 201,
      message: 'Dang ky tai khoan thanh cong.',
      data: { accepted: true },
    });

    const customer = await customersRepository.findOneByOrFail({ email });
    createdCustomerIds.push(customer.id);
    expect(customer.fullName).toBe('Auth E2E Customer');
    expect(customer.phone).toBe(toCanonicalPhone(localPhone));
    expect(customer.status).toBe('ACTIVE');

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/customers/login')
      .send({ identifier: formatLocalPhone(localPhone), password: PASSWORD })
      .expect(200);
    const loginBody = loginResponse.body as ResponseEnvelope<LoginData>;
    const token = loginBody.data.accessToken;

    expect(loginBody.data.actorType).toBe('customer');
    expect(accessTokenService.verify(token)).toMatchObject({
      actor_type: 'customer',
      customer_id: customer.id,
      token_version: customer.tokenVersion,
    });

    const meResponse = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer ' + token)
      .expect(200);
    const meBody = meResponse.body as ResponseEnvelope<{
      actorType: 'customer';
      customer: Record<string, unknown>;
    }>;
    expect(meBody.data).toMatchObject({
      actorType: 'customer',
      customer: {
        id: customer.id,
        fullName: 'Auth E2E Customer',
        phone: toCanonicalPhone(localPhone),
        status: 'ACTIVE',
      },
    });
    expect(meBody.data.customer).not.toHaveProperty('passwordHash');

    await customersRepository.update(customer.id, {
      tokenVersion: customer.tokenVersion + 1,
    });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer ' + token)
      .expect(401);

    const duplicateEmailResponse = await registerCustomer(
      email,
      nextLocalPhone(),
    );
    const duplicatePhoneEmail = nextEmail('duplicate-phone');
    const duplicatePhoneResponse = await registerCustomer(
      duplicatePhoneEmail,
      localPhone,
    );
    const raceEmail = nextEmail('race');
    const racePhone = nextLocalPhone();
    const raceResponses = await Promise.all([
      registerCustomer(raceEmail, racePhone),
      registerCustomer(raceEmail, racePhone),
    ]);

    for (const registrationResponse of [
      duplicateEmailResponse,
      duplicatePhoneResponse,
    ]) {
      expect(registrationResponse.body).toMatchObject({
        success: false,
        statusCode: 409,
        message: 'Khong the dang ky bang email hoac so dien thoai nay.',
        error: 'Conflict',
      });
    }

    expect(raceResponses.map((item) => item.status).sort()).toEqual([201, 409]);
    expect(
      raceResponses.find((item) => item.status === 409)?.body,
    ).toMatchObject({
      success: false,
      statusCode: 409,
      message: 'Khong the dang ky bang email hoac so dien thoai nay.',
      error: 'Conflict',
    });

    const baseCustomers = await customersRepository.findBy({ email });
    const raceCustomers = await customersRepository.findBy({
      email: raceEmail,
    });
    expect(baseCustomers).toHaveLength(1);
    expect(raceCustomers).toHaveLength(1);
    createdCustomerIds.push(raceCustomers[0].id);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customers/login')
      .send({ identifier: raceEmail, password: PASSWORD })
      .expect(200);
    expect(
      await customersRepository.countBy({ email: duplicatePhoneEmail }),
    ).toBe(0);
  });

  it('uses one public login failure for missing, wrong, locked, passwordless, and malformed accounts', async () => {
    const active = await createCustomer();
    const locked = await createCustomer({ status: 'LOCKED' });
    const passwordless = await createCustomer({ passwordHash: null });
    const malformed = await createCustomer({
      passwordHash: 'not-a-scrypt-hash',
    });
    const requests = [
      { identifier: nextEmail('missing'), password: PASSWORD },
      { identifier: active.email as string, password: 'WrongPassword456!' },
      { identifier: locked.email as string, password: PASSWORD },
      { identifier: passwordless.email as string, password: PASSWORD },
      { identifier: malformed.email as string, password: PASSWORD },
    ];

    const failures: Array<Record<string, unknown>> = [];
    for (const input of requests) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/customers/login')
        .send(input);
      expect(response.status).toBe(401);
      failures.push(publicFailure(response.body));
    }

    expect(
      new Set(failures.map((failure) => JSON.stringify(failure))).size,
    ).toBe(1);
    expect(failures[0]).toEqual({
      success: false,
      statusCode: 401,
      message: 'Thong tin dang nhap khong hop le.',
      error: 'Unauthorized',
    });
  });

  it('refreshes the user role from the database and rejects revoked, malformed, and locked tokens', async () => {
    const user = await createUser({ role: 'STAFF' });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/users/login')
      .send({ identifier: user.email, password: PASSWORD })
      .expect(200);
    const token = (loginResponse.body as ResponseEnvelope<LoginData>).data
      .accessToken;

    expect(accessTokenService.verify(token)).toMatchObject({
      actor_type: 'user',
      user_id: user.id,
      role: 'STAFF',
      token_version: user.tokenVersion,
    });
    await expectAuthMeFailure(undefined, 401);
    await expectAuthMeFailure('Bearer ' + token + ' trailing-data', 401);
    await expectAuthMeFailure('Bearer ' + tamperToken(token), 401);

    await usersRepository.update(user.id, { role: 'ADMIN' });
    const roleResponse = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer ' + token)
      .expect(200);
    const roleBody = roleResponse.body as ResponseEnvelope<{
      actorType: 'user';
      user: { role: string };
    }>;
    expect(roleBody.data.user.role).toBe('ADMIN');

    await usersRepository.update(user.id, {
      tokenVersion: user.tokenVersion + 1,
    });
    await expectAuthMeFailure('Bearer ' + token, 401);

    const locked = await createCustomer({ status: 'LOCKED' });
    const lockedToken = accessTokenService.sign({
      actorType: 'customer',
      customerId: locked.id,
      tokenVersion: locked.tokenVersion,
    });
    await expectAuthMeFailure('Bearer ' + lockedToken, 403);
  });

  it('documents the /auth/me rate-limit response and observes login throttling', async () => {
    const document = createOpenApiDocument(app);
    const responses = (
      document.paths['/api/v1/auth/me'] as {
        get?: { responses?: Record<string, unknown> };
      }
    )?.get?.responses;
    expect(responses).toHaveProperty('429');

    let rateLimitedResponse: request.Response | null = null;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/users/login')
        .send({
          identifier: nextEmail('rate-limit'),
          password: 'WrongPassword456!',
        });

      if (response.status === 429) {
        rateLimitedResponse = response;
        break;
      }

      expect(response.status).toBe(401);
    }

    expect(rateLimitedResponse?.status).toBe(429);
    expect(rateLimitedResponse?.headers['retry-after']).toEqual(
      expect.any(String),
    );
  });

  async function registerCustomer(
    email: string,
    localPhone: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/api/v1/auth/customers/register')
      .send({
        fullName: 'Auth E2E Registration',
        email,
        phone: localPhone,
        password: PASSWORD,
      });
  }

  async function createCustomer(
    overrides: Partial<Customer> = {},
  ): Promise<Customer> {
    const sequence = nextSequence();
    const passwordHash = Object.prototype.hasOwnProperty.call(
      overrides,
      'passwordHash',
    )
      ? overrides.passwordHash
      : await passwordHasher.hash(PASSWORD);
    const customer = await customersRepository.save(
      customersRepository.create({
        fullName: 'Auth E2E Fixture ' + sequence,
        email: nextEmail('fixture-' + sequence),
        phone: toCanonicalPhone(nextLocalPhone()),
        passwordHash,
        tokenVersion: 0,
        status: 'ACTIVE',
        ...overrides,
      }),
    );
    createdCustomerIds.push(customer.id);
    return customer;
  }

  async function createUser(overrides: Partial<User> = {}): Promise<User> {
    const sequence = nextSequence();
    const passwordHash = Object.prototype.hasOwnProperty.call(
      overrides,
      'passwordHash',
    )
      ? overrides.passwordHash
      : await passwordHasher.hash(PASSWORD);
    const user = await usersRepository.save(
      usersRepository.create({
        fullName: 'Auth E2E User ' + sequence,
        email: nextEmail('user-' + sequence),
        phone: null,
        passwordHash: passwordHash as string,
        tokenVersion: 0,
        role: 'STAFF',
        status: 'ACTIVE',
        ...overrides,
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  async function expectAuthMeFailure(
    authorization: string | undefined,
    status: number,
  ): Promise<void> {
    const response = request(app.getHttpServer()).get('/api/v1/auth/me');
    if (authorization !== undefined) {
      response.set('Authorization', authorization);
    }
    await response.expect(status);
  }

  function publicFailure(body: unknown): Record<string, unknown> {
    const value = body as Record<string, unknown>;
    return {
      success: value.success,
      statusCode: value.statusCode,
      message: value.message,
      error: value.error,
    };
  }

  function nextSequence(): number {
    fixtureSequence += 1;
    return fixtureSequence;
  }

  function nextEmail(label: string): string {
    return (
      'auth-' +
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

  function toCanonicalPhone(localPhone: string): string {
    return '+84' + localPhone.slice(1);
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

  function tamperToken(token: string): string {
    const replacement = token.endsWith('x') ? 'y' : 'x';
    return token.slice(0, -1) + replacement;
  }
});
