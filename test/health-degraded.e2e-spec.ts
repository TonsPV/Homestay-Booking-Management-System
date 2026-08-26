import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { PoolConnection, QueryError } from 'mysql2';
import request from 'supertest';
import type { App } from 'supertest/types';

import { HealthModule } from '../src/common/health/health.module';
import { HEALTH_DATABASE_POOL } from '../src/common/health/health-database-probe.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { validateEnvironment } from '../src/config/environment';

interface ApiErrorBody {
  success: false;
  statusCode: number;
  message: string;
}

describe('Health readiness under degraded database conditions (e2e)', () => {
  let app: INestApplication<App>;
  let pool: {
    getConnection: jest.Mock;
    end: jest.Mock;
  };
  let stalledConnection: {
    query: jest.Mock;
    release: jest.Mock;
    destroy: jest.Mock;
  };
  let healthyConnection: {
    query: jest.Mock;
    release: jest.Mock;
    destroy: jest.Mock;
  };
  let resolveQueryStarted: () => void;
  let queryStarted: Promise<void>;
  const originalProbeTimeout = process.env.HEALTH_DB_PROBE_TIMEOUT_MS;

  beforeAll(async () => {
    process.env.HEALTH_DB_PROBE_TIMEOUT_MS = '100';
    queryStarted = new Promise<void>((resolve) => {
      resolveQueryStarted = resolve;
    });
    stalledConnection = {
      query: jest.fn(
        (
          ...args: [
            { sql: string; timeout: number },
            (error: QueryError | null) => void,
          ]
        ) => {
          expect(args[0].timeout).toBe(100);
          resolveQueryStarted();
        },
      ),
      release: jest.fn(),
      destroy: jest.fn(),
    };
    healthyConnection = {
      query: jest.fn(
        (
          ...args: [
            { sql: string; timeout: number },
            (error: QueryError | null) => void,
          ]
        ) => {
          expect(args[0].timeout).toBe(100);
          args[1](null);
        },
      ),
      release: jest.fn(),
      destroy: jest.fn(),
    };
    pool = {
      getConnection: jest
        .fn()
        .mockImplementationOnce(
          (
            callback: (
              error: QueryError | null,
              connection: PoolConnection,
            ) => void,
          ) => callback(null, stalledConnection as unknown as PoolConnection),
        )
        .mockImplementation(
          (
            callback: (
              error: QueryError | null,
              connection: PoolConnection,
            ) => void,
          ) => callback(null, healthyConnection as unknown as PoolConnection),
        ),
      end: jest.fn((callback: (error: QueryError | null) => void) =>
        callback(null),
      ),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnvironment,
        }),
        HealthModule,
      ],
    })
      .overrideProvider(HEALTH_DATABASE_POOL)
      .useValue(pool)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();

    if (originalProbeTimeout === undefined) {
      delete process.env.HEALTH_DB_PROBE_TIMEOUT_MS;
    } else {
      process.env.HEALTH_DB_PROBE_TIMEOUT_MS = originalProbeTimeout;
    }
  });

  it('caps concurrent probes, destroys timed-out work, and recovers', async () => {
    const stalledRequest = request(app.getHttpServer())
      .get('/api/health/ready')
      .then((response) => response);

    await queryStarted;

    const excessResponses = await Promise.all(
      Array.from({ length: 12 }, () =>
        request(app.getHttpServer()).get('/api/health/ready'),
      ),
    );

    expect(excessResponses).toHaveLength(12);

    for (const response of excessResponses) {
      expect(response.status).toBe(503);
      expect(response.body as ApiErrorBody).toMatchObject({
        success: false,
        statusCode: 503,
        message: 'Database is unavailable.',
      });
    }

    expect(pool.getConnection).toHaveBeenCalledTimes(1);

    const timedOutResponse = await stalledRequest;

    expect(timedOutResponse.status).toBe(503);
    expect(timedOutResponse.body as ApiErrorBody).toMatchObject({
      success: false,
      statusCode: 503,
      message: 'Database is unavailable.',
    });
    expect(stalledConnection.destroy).toHaveBeenCalledTimes(1);
    expect(stalledConnection.release).not.toHaveBeenCalled();

    const recoveredResponse = await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(200);

    expect(recoveredResponse.body).toHaveProperty('data.status', 'ok');
    expect(pool.getConnection).toHaveBeenCalledTimes(2);
    expect(healthyConnection.release).toHaveBeenCalledTimes(1);
    expect(healthyConnection.destroy).not.toHaveBeenCalled();
  });
});
