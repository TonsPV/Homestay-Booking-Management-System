import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/http';
import migrationDataSource from '../src/database/data-source';
import { Customer } from '../src/module/customer/schema/customer.entity';
import { E2eHarness } from './e2e-harness';

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

  it('propagates safe request IDs, shared envelopes, Helmet and CORS headers', async () => {
    const valid = await request(app.getHttpServer())
      .get('/api/health/live')
      .set('X-Request-Id', 'common-http-id')
      .set('Origin', 'http://frontend.example')
      .expect(200);
    const validBody = valid.body as ResponseBody<{ status: string }>;

    expect(validBody).toMatchObject({
      success: true,
      statusCode: 200,
      message: 'Thanh cong.',
      data: { status: 'ok' },
      path: '/api/health/live',
      requestId: 'common-http-id',
    });
    expect(valid.headers['x-request-id']).toBe('common-http-id');
    expect(valid.headers['x-content-type-options']).toBe('nosniff');
    expect(valid.headers['access-control-allow-origin']).toBe(
      'http://frontend.example',
    );

    const invalid = await request(app.getHttpServer())
      .get('/api/health/live')
      .set('X-Request-Id', 'unsafe request id')
      .expect(200);
    const invalidBody = invalid.body as ResponseBody<{ status: string }>;

    expect(invalidBody.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(invalid.headers['x-request-id']).toBe(invalidBody.requestId);

    const error = await request(app.getHttpServer())
      .get('/api/not-a-route')
      .set('X-Request-Id', 'common-error-id')
      .expect(404);
    const errorBody = error.body as ResponseBody<null> & { error: string };
    expect(errorBody).toMatchObject({
      success: false,
      statusCode: 404,
      path: '/api/not-a-route',
      requestId: 'common-error-id',
      error: 'Not Found',
    });
  });

  it('characterizes the current unknown-field policy at a DTO boundary', async () => {
    const email = `common-http-${suffix}@example.com`;
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customers/register')
      .send({
        fullName: 'Common HTTP Customer',
        email,
        phone: '090' + String(Date.now()).slice(-7),
        password: 'StrongPassword123!',
        unexpectedField: 'ignored-by-current-boundary',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      success: true,
      statusCode: 201,
      data: { accepted: true },
    });
    const customer = await customers.findOneByOrFail({ email });
    customerIds.push(customer.id);
    // Current controllers/services ignore unknown JSON keys; no unexpected
    // field is persisted. Whether to reject them globally is a policy decision.
    expect(customer).not.toHaveProperty('unexpectedField');
  });
});
