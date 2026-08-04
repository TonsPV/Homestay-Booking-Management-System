import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/http';
import migrationDataSource from '../src/database/data-source';
import { HealthDatabaseProbeService } from '../src/common/health/health-database-probe.service';
import { E2eHarness } from './e2e-harness';

describe('Health and runtime workflow (e2e)', () => {
  let app: INestApplication<App>;
  let harness: E2eHarness | undefined;

  beforeAll(async () => {
    harness = new E2eHarness(migrationDataSource);
    await harness.initialize();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    try {
      await harness?.cleanup();
    } finally {
      await app?.close();
    }
  });

  it('keeps liveness independent from the database and sanitizes readiness failures', async () => {
    const probe = app.get(HealthDatabaseProbeService);
    const liveProbe = jest.spyOn(probe, 'check');

    await request(app.getHttpServer()).get('/api/health/live').expect(200);
    expect(liveProbe).not.toHaveBeenCalled();
    liveProbe.mockRestore();

    await request(app.getHttpServer()).get('/api/health/ready').expect(200);

    const failureProbe = jest
      .spyOn(probe, 'check')
      .mockRejectedValue(
        new Error('mysql://admin:secret@database.internal/hbms'),
      );
    const failed = await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(503);
    failureProbe.mockRestore();

    expect(failed.body).toMatchObject({
      success: false,
      statusCode: 503,
      message: 'Database is unavailable.',
    });
    expect(JSON.stringify(failed.body)).not.toContain('database.internal');
    expect(JSON.stringify(failed.body)).not.toContain('secret');
  });

  it('enforces readiness rate limit and returns Retry-After', async () => {
    const responses = [];
    // The previous workflow consumed two requests in this app instance.
    for (let index = 0; index < 29; index += 1) {
      responses.push(
        await request(app.getHttpServer()).get('/api/health/ready'),
      );
    }

    expect(
      responses.slice(0, 28).every((response) => response.status === 200),
    ).toBe(true);
    expect(responses[28]?.status).toBe(429);
    expect(responses[28]?.headers['retry-after']).toEqual(expect.any(String));
  });
});
