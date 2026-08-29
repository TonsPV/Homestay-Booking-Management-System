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

interface ResponseBody<T> {
  success: boolean;
  statusCode: number;
  message: string | string[];
  data: T;
  path: string;
  requestId: string;
}

describe('Common HTTP workflow (e2e)', () => {
  let app: INestApplication<App>;
  let harness: E2eHarness | undefined;
  let customers: Repository<Customer>;
  const suffix = E2eHarness.createUniqueSuffix();
  const customerIds: string[] = [];

  beforeAll(async () => {
    harness = new E2eHarness(migrationDataSource);
    await harness.initialize();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ bodyParser: false });
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

  it('propagates safe request IDs, shared error envelopes, Helmet and CORS headers', async () => {
    const allowedOrigin = process.env.CORS_ORIGINS?.split(',')[0]?.trim();

    if (allowedOrigin === undefined || allowedOrigin.length === 0) {
      throw new Error('CORS_ORIGINS must provide an allowed E2E origin.');
    }

    const valid = await request(app.getHttpServer())
      .get('/api/not-a-route')
      .set('X-Request-Id', 'common-http-id')
      .set('Origin', allowedOrigin)
      .expect(404);
    const validBody = valid.body as ResponseBody<null> & { error: string };

    expect(validBody).toMatchObject({
      success: false,
      statusCode: 404,
      path: '/api/not-a-route',
      requestId: 'common-http-id',
      error: 'Not Found',
    });
    expect(valid.headers['x-request-id']).toBe('common-http-id');
    expect(valid.headers['x-content-type-options']).toBe('nosniff');
    expect(valid.headers['access-control-allow-origin']).toBe(allowedOrigin);

    const invalid = await request(app.getHttpServer())
      .get('/api/not-a-route')
      .set('X-Request-Id', 'unsafe request id')
      .expect(404);
    const invalidBody = invalid.body as ResponseBody<null> & { error: string };

    expect(invalidBody.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(invalid.headers['x-request-id']).toBe(invalidBody.requestId);
  });

  it('rejects unknown fields at the global DTO validation boundary', async () => {
    const email = `common-http-${suffix}@example.com`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/customers/register')
      .send({
        fullName: 'Common HTTP Customer',
        email,
        phone: '090' + String(Date.now()).slice(-7),
        password: 'StrongPassword123!',
        unexpectedField: 'ignored-by-current-boundary',
      })
      .expect(400);

    const validEmail = `common-http-valid-${suffix}@example.com`;
    const valid = await request(app.getHttpServer())
      .post('/api/v1/auth/customers/register')
      .send({
        fullName: 'Common HTTP Customer',
        email: validEmail,
        phone: '090' + String(Date.now() + 1).slice(-7),
        password: 'StrongPassword123!',
      })
      .expect(201);

    expect(valid.body).toMatchObject({
      success: true,
      statusCode: 201,
      data: { accepted: true },
    });
    const customer = await customers.findOneByOrFail({ email: validEmail });
    customerIds.push(customer.id);
  });

  it('rejects JSON bodies over the configured parser limit', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customers/register')
      .send({
        fullName: 'x'.repeat(1_100_000),
        phone: '0901234567',
        password: 'StrongPassword123!',
      });

    expect(response.status).toBe(413);
  });
});
