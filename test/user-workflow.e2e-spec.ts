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

interface UserPayload {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: 'STAFF' | 'ADMIN';
  status: 'ACTIVE' | 'LOCKED';
}

describe('User workflow (e2e)', () => {
  let app: INestApplication<App>;
  let e2eHarness: E2eHarness | undefined;
  let usersRepository: Repository<User>;
  let customersRepository: Repository<Customer>;
  let passwordHasher: PasswordHasherService;
  let accessTokenService: AccessTokenService;
  let admin: User;
  let adminToken: string;
  const createdUserIds: string[] = [];
  const createdCustomerIds: string[] = [];
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
    usersRepository = dataSource.getRepository(User);
    customersRepository = dataSource.getRepository(Customer);
    passwordHasher = app.get(PasswordHasherService);
    accessTokenService = app.get(AccessTokenService);
    admin = await createDirectUser({ role: 'ADMIN' });
    adminToken = tokenForUser(admin);

    e2eHarness.registerCleanup(async () => {
      const customerIds = [...new Set(createdCustomerIds)];
      const userIds = [...new Set(createdUserIds)];

      if (customerIds.length > 0) {
        await customersRepository.delete(customerIds);
      }

      if (userIds.length > 0) {
        await usersRepository.delete(userIds);
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

  it('enforces admin-only access and creates only STAFF responses', async () => {
    await request(app.getHttpServer()).get('/api/v1/users').expect(401);

    const customer = await createDirectCustomer();
    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', 'Bearer ' + tokenForCustomer(customer))
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        fullName: 'Rejected ADMIN',
        email: nextEmail('rejected-admin'),
        password: PASSWORD,
        role: 'ADMIN',
      })
      .expect(400);

    const response = await createStaff({
      fullName: '  User E2E Staff  ',
      email: nextEmail('staff-access'),
      phone: nextLocalPhone(),
    });
    const body = response.body as ResponseEnvelope<UserPayload>;

    expect(body.data).toMatchObject({
      fullName: 'User E2E Staff',
      role: 'STAFF',
      status: 'ACTIVE',
    });
    expect(body.data).not.toHaveProperty('passwordHash');
    expect(body.data).not.toHaveProperty('tokenVersion');
    expect(body.data).not.toHaveProperty('deletedAt');
  });

  it('lists, filters, normalizes, and updates a STAFF account while revoking password-reset tokens', async () => {
    const email = nextEmail('staff-update');
    const createResponse = await createStaff({
      fullName: 'User E2E Update',
      email,
      phone: nextLocalPhone(),
    });
    const created = createResponse.body as ResponseEnvelope<UserPayload>;
    const staffId = created.data.id;
    const staff = await usersRepository.findOneByOrFail({ id: staffId });
    const oldToken = tokenForUser(staff);

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/users')
      .query({
        page: 1,
        limit: 1,
        search: email,
        role: 'STAFF',
        status: 'ACTIVE',
      })
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    const listBody = listResponse.body as ResponseEnvelope<UserPayload[]>;
    expect(listBody.data).toEqual([
      expect.objectContaining({ id: staffId, email, role: 'STAFF' }),
    ]);
    expect(listBody.data[0]).not.toHaveProperty('passwordHash');
    expect(listBody.meta?.pagination).toMatchObject({
      page: 1,
      limit: 1,
      total: 1,
      totalPages: 1,
    });

    const updateResponse = await request(app.getHttpServer())
      .patch('/api/v1/users/' + staffId)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        fullName: '  Updated User  ',
        email: ' ' + nextEmail('staff-updated').toUpperCase() + ' ',
        phone: formatLocalPhone(nextLocalPhone()),
        password: 'UpdatedPassword456!',
      })
      .expect(200);
    const updateBody = updateResponse.body as ResponseEnvelope<UserPayload>;
    const updated = await usersRepository.findOneByOrFail({ id: staffId });

    expect(updateBody.data).toMatchObject({
      id: staffId,
      fullName: 'Updated User',
      email: updated.email,
      phone: updated.phone,
      role: 'STAFF',
      status: 'ACTIVE',
    });
    expect(updated.tokenVersion).toBe(staff.tokenVersion + 1);
    await request(app.getHttpServer())
      .get('/api/v1/management/rooms')
      .set('Authorization', 'Bearer ' + oldToken)
      .expect(401);

    const freshToken = tokenForUser(updated);
    await request(app.getHttpServer())
      .get('/api/v1/management/rooms')
      .set('Authorization', 'Bearer ' + freshToken)
      .expect(200);

    await request(app.getHttpServer())
      .patch('/api/v1/users/' + staffId)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/users/' + staffId)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ role: 'ADMIN' })
      .expect(400);
  });

  it('locks and unlocks a STAFF account with monotonic token revocation and idempotent status updates', async () => {
    const createResponse = await createStaff({
      email: nextEmail('staff-status'),
      phone: nextLocalPhone(),
    });
    const staffId = (createResponse.body as ResponseEnvelope<UserPayload>).data
      .id;
    const staff = await usersRepository.findOneByOrFail({ id: staffId });
    const preLockToken = tokenForUser(staff);

    const lockResponse = await request(app.getHttpServer())
      .patch('/api/v1/users/' + staffId + '/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: 'LOCKED' })
      .expect(200);
    expect(
      (lockResponse.body as ResponseEnvelope<UserPayload>).data,
    ).toMatchObject({ id: staffId, status: 'LOCKED' });
    const locked = await usersRepository.findOneByOrFail({ id: staffId });
    expect(locked.tokenVersion).toBe(staff.tokenVersion + 1);

    await request(app.getHttpServer())
      .get('/api/v1/management/rooms')
      .set('Authorization', 'Bearer ' + tokenForUser(locked))
      .expect(403);

    const unlockResponse = await request(app.getHttpServer())
      .patch('/api/v1/users/' + staffId + '/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: 'ACTIVE' })
      .expect(200);
    expect(
      (unlockResponse.body as ResponseEnvelope<UserPayload>).data,
    ).toMatchObject({ id: staffId, status: 'ACTIVE' });
    const unlocked = await usersRepository.findOneByOrFail({ id: staffId });
    expect(unlocked.tokenVersion).toBe(staff.tokenVersion + 2);

    await request(app.getHttpServer())
      .get('/api/v1/management/rooms')
      .set('Authorization', 'Bearer ' + preLockToken)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/management/rooms')
      .set('Authorization', 'Bearer ' + tokenForUser(locked))
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/management/rooms')
      .set('Authorization', 'Bearer ' + tokenForUser(unlocked))
      .expect(200);

    await request(app.getHttpServer())
      .patch('/api/v1/users/' + staffId + '/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: 'ACTIVE' })
      .expect(200);
    const idempotent = await usersRepository.findOneByOrFail({ id: staffId });
    expect(idempotent.tokenVersion).toBe(unlocked.tokenVersion);
  });

  it('prevents ADMIN self-demotion/self-lock and normalizes duplicate and concurrent create conflicts', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/users/' + admin.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ role: 'STAFF' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/users/' + admin.id + '/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: 'LOCKED' })
      .expect(400);

    const duplicateEmail = nextEmail('duplicate-user');
    const duplicatePhone = nextLocalPhone();
    const first = await createStaff({
      email: duplicateEmail,
      phone: duplicatePhone,
    });
    const firstBody = first.body as ResponseEnvelope<UserPayload>;

    await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        fullName: 'Duplicate email',
        email: duplicateEmail,
        phone: nextLocalPhone(),
        password: PASSWORD,
      })
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        fullName: 'Duplicate phone',
        email: nextEmail('duplicate-phone'),
        phone: duplicatePhone,
        password: PASSWORD,
      })
      .expect(409);

    const raceEmail = nextEmail('user-race');
    const racePhone = nextLocalPhone();
    const raceResponses = await Promise.all([
      createStaff({ email: raceEmail, phone: racePhone }, false),
      createStaff({ email: raceEmail, phone: racePhone }, false),
    ]);
    const raceStatuses = raceResponses
      .map((response) => response.status)
      .sort();
    expect(raceStatuses).toEqual([201, 409]);
    const raceUsers = await usersRepository.findBy({ email: raceEmail });
    expect(raceUsers).toHaveLength(1);
    createdUserIds.push(firstBody.data.id, raceUsers[0].id);
  });

  it('characterizes concurrent password and status mutations on one STAFF row', async () => {
    const createResponse = await createStaff({
      email: nextEmail('user-mutation-race'),
      phone: nextLocalPhone(),
    });
    const staffId = (createResponse.body as ResponseEnvelope<UserPayload>).data
      .id;

    const responses = await Promise.all([
      request(app.getHttpServer())
        .patch('/api/v1/users/' + staffId + '/status')
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ status: 'LOCKED' }),
      request(app.getHttpServer())
        .patch('/api/v1/users/' + staffId)
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ password: 'ConcurrentPassword456!' }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 200,
    ]);
    const finalUser = await usersRepository.findOneByOrFail({ id: staffId });
    expect(finalUser.status).toBe('LOCKED');
    expect(finalUser.tokenVersion).toBe(2);
  });

  async function createDirectUser(
    overrides: Partial<User> = {},
  ): Promise<User> {
    const sequence = nextSequence();
    const passwordHash = Object.prototype.hasOwnProperty.call(
      overrides,
      'passwordHash',
    )
      ? overrides.passwordHash
      : await passwordHasher.hash(PASSWORD);
    const user = await usersRepository.save(
      usersRepository.create({
        fullName: 'User E2E Direct ' + sequence,
        email: nextEmail('direct-user-' + sequence),
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

  async function createDirectCustomer(): Promise<Customer> {
    const customer = await customersRepository.save(
      customersRepository.create({
        fullName: 'User E2E Customer',
        email: nextEmail('customer'),
        phone: '+84' + nextLocalPhone().slice(1),
        passwordHash: null,
        tokenVersion: 0,
        status: 'ACTIVE',
      }),
    );
    createdCustomerIds.push(customer.id);
    return customer;
  }

  async function createStaff(
    overrides: {
      fullName?: string;
      email?: string;
      phone?: string;
    } = {},
    expectSuccess = true,
  ): Promise<request.Response> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        fullName: overrides.fullName ?? 'User E2E Staff',
        email: overrides.email ?? nextEmail('staff'),
        phone: overrides.phone ?? nextLocalPhone(),
        password: PASSWORD,
      });

    if (expectSuccess && response.status !== 201) {
      throw new Error(
        'Unexpected STAFF create response: ' +
          response.status +
          ' ' +
          JSON.stringify(response.body),
      );
    }

    if (response.status === 201) {
      const body = response.body as ResponseEnvelope<UserPayload>;
      if (body.data?.id !== undefined) {
        createdUserIds.push(body.data.id);
      }
    }

    return response;
  }

  function tokenForUser(user: User): string {
    return accessTokenService.sign({
      actorType: 'user',
      userId: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
  }

  function tokenForCustomer(customer: Customer): string {
    return accessTokenService.sign({
      actorType: 'customer',
      customerId: customer.id,
      tokenVersion: customer.tokenVersion,
    });
  }

  function nextSequence(): number {
    fixtureSequence += 1;
    return fixtureSequence;
  }

  function nextEmail(label: string): string {
    return (
      'user-' +
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
