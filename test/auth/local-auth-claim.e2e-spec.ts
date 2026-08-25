import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import migrationDataSource from '../../src/database/data-source';
import { PasswordHasherService } from '../../src/module/auth/password-hasher.service';
import { Customer } from '../../src/module/customer/schema/customer.entity';
import { E2eHarness } from '../e2e-harness';

const PASSWORD = 'StrongPassword123!';
const DIFFERENT_PASSWORD = 'DifferentPassword456!';

describe('Local passwordless Customer claim (e2e)', () => {
  let app: INestApplication<App>;
  let harness: E2eHarness | undefined;
  let customers: Repository<Customer>;
  let passwordHasher: PasswordHasherService;
  const customerIds: string[] = [];
  const suffix = E2eHarness.createUniqueSuffix();
  let sequence = 0;

  beforeAll(async () => {
    harness = new E2eHarness(migrationDataSource);
    await harness.initialize();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    const dataSource = app.get(DataSource);
    customers = dataSource.getRepository(Customer);
    passwordHasher = app.get(PasswordHasherService);

    harness.registerCleanup(async () => {
      if (customerIds.length > 0) {
        await customers.delete([...new Set(customerIds)]);
      }
    });
  });

  afterAll(async () => {
    try {
      await harness?.cleanup();
    } finally {
      await app?.close();
    }
  });

  it('sets the first local password and logs into the original counter Customer', async () => {
    const counterCustomer = await createCustomer({
      email: null,
      passwordHash: null,
    });
    const claimEmail = `local-claim-${suffix}@example.com`;

    await request(app.getHttpServer())
      .post('/api/v1/auth/customers/register')
      .send({
        fullName: 'Attempted Profile Replacement',
        email: claimEmail,
        phone: counterCustomer.phone,
        password: PASSWORD,
      })
      .expect(201);

    const claimed = await customers
      .createQueryBuilder('customer')
      .addSelect('customer.passwordHash')
      .where('customer.id = :id', { id: counterCustomer.id })
      .getOneOrFail();
    expect(claimed).toMatchObject({
      id: counterCustomer.id,
      fullName: counterCustomer.fullName,
      email: claimEmail,
      phone: counterCustomer.phone,
      phoneVerifiedAt: null,
      tokenVersion: counterCustomer.tokenVersion + 1,
    });
    await expect(
      passwordHasher.verify(PASSWORD, claimed.passwordHash),
    ).resolves.toBe(true);

    await request(app.getHttpServer())
      .post('/api/v1/auth/customers/login')
      .send({ identifier: claimEmail, password: PASSWORD })
      .expect(200);
  });

  it('never overwrites the password of an already configured Customer', async () => {
    const configured = await createCustomer({
      passwordHash: await passwordHasher.hash(PASSWORD),
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/customers/register')
      .send({
        fullName: configured.fullName,
        email: configured.email,
        phone: configured.phone,
        password: DIFFERENT_PASSWORD,
      })
      .expect(409);

    await request(app.getHttpServer())
      .post('/api/v1/auth/customers/login')
      .send({ identifier: configured.phone, password: PASSWORD })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customers/login')
      .send({ identifier: configured.phone, password: DIFFERENT_PASSWORD })
      .expect(401);
  });

  async function createCustomer(
    overrides: Partial<Customer>,
  ): Promise<Customer> {
    sequence += 1;
    const customer = await customers.save(
      customers.create({
        fullName: 'Local Counter Customer ' + sequence,
        email: `local-counter-${suffix}-${sequence}@example.com`,
        phone: '+849' + String(20_000_000 + sequence).slice(-8),
        passwordHash: null,
        phoneVerifiedAt: null,
        tokenVersion: 0,
        status: 'ACTIVE',
        ...overrides,
      }),
    );
    customerIds.push(customer.id);
    return customer;
  }
});
