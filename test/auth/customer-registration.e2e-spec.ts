import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import migrationDataSource from '../../src/database/data-source';
import { Customer } from '../../src/module/customer/schema/customer.entity';
import { E2eHarness } from '../e2e-harness';

const PASSWORD = 'StrongPassword123!';

describe('Customer registration (e2e)', () => {
  let app: INestApplication<App>;
  let harness: E2eHarness | undefined;
  let customers: Repository<Customer>;
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

    customers = app.get(DataSource).getRepository(Customer);

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

  it('does not claim an existing passwordless Customer through registration', async () => {
    const counterCustomer = await createCustomer({
      email: null,
      passwordHash: null,
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/customers/register')
      .send({
        fullName: 'Attempted Profile Replacement',
        email: `registration-${suffix}@example.com`,
        phone: counterCustomer.phone,
        password: PASSWORD,
      })
      .expect(409);

    const unchanged = await customers
      .createQueryBuilder('customer')
      .addSelect('customer.passwordHash')
      .where('customer.id = :id', { id: counterCustomer.id })
      .getOneOrFail();

    expect(unchanged).toMatchObject({
      id: counterCustomer.id,
      fullName: counterCustomer.fullName,
      email: null,
      phone: counterCustomer.phone,
      passwordHash: null,
      tokenVersion: counterCustomer.tokenVersion,
    });
  });

  async function createCustomer(
    overrides: Partial<Customer>,
  ): Promise<Customer> {
    sequence += 1;
    const customer = await customers.save(
      customers.create({
        fullName: 'Counter Customer ' + sequence,
        email: `counter-${suffix}-${sequence}@example.com`,
        phone: '+849' + String(20_000_000 + sequence).slice(-8),
        passwordHash: null,
        tokenVersion: 0,
        status: 'ACTIVE',
        ...overrides,
      }),
    );
    customerIds.push(customer.id);
    return customer;
  }
});
