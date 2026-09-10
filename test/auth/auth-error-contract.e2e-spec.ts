import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import { DataSource, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import migrationDataSource from '../../src/database/data-source';
import { AccessTokenService } from '../../src/module/auth/access-token.service';
import { CustomerAuthorizationReader } from '../../src/module/auth/authorization/customer-authorization-reader';
import { PasswordHasherService } from '../../src/module/auth/password-hasher.service';
import { Customer } from '../../src/module/customer/schema/customer.entity';
import { E2eHarness } from '../e2e-harness';

/**
 * Real-HTTP regression suite for the pre-Passport authentication error
 * contract. Every case travels the full pipeline:
 * real Nest app -> JwtAuthGuard -> Passport -> exception filter -> response.
 *
 * Nothing here mocks super.canActivate() or the strategy: failures are
 * produced by real Authorization headers and real (signed) tokens, and the
 * system-error case patches the DB reader at the DI boundary so the
 * unexpected-failure path is proven NOT to become a 401.
 */

const BEARER_HEADER_REJECTIONS: Array<[string, string]> = [
  ['missing Authorization', 'undefined-marker'],
  ['Basic scheme', 'Basic xxx'],
  ['lowercase bearer scheme', 'bearer xxx'],
  ['uppercase BEARER scheme', 'BEARER xxx'],
  ['scheme without token', 'Bearer'],
  ['extra space before token', 'Bearer  token'],
  ['extra segments after token', 'Bearer token extra'],
];

// Node's HTTP parser trims optional whitespace surrounding a header value
// before Nest/Express receives it. The strict extractor still rejects these
// forms when exercised directly (see strict-bearer.extractor.spec.ts), but a
// real HTTP request reaches the legacy guard as `Bearer token`, which is an
// invalid JWT and therefore uses the invalid-token message.
const NORMALIZED_BEARER_HEADERS: Array<[string, string]> = [
  ['leading whitespace', ' Bearer token'],
  ['trailing whitespace', 'Bearer token '],
];

const UNAUTHORIZED_FALLBACK = {
  errorCode: 'COMMON_UNAUTHORIZED',
  error: 'Unauthorized',
} as const;

describe('Auth error contract (e2e, real HTTP pipeline)', () => {
  const PASSWORD = 'StrongPassword123!';
  const SYSTEM_ERROR_CUSTOMER_ID = 'system-error-trigger-customer';
  const UNIQUE_SUFFIX = E2eHarness.createUniqueSuffix();

  let app: INestApplication<App>;
  let e2eHarness: E2eHarness | undefined;
  let customerRepo: Repository<Customer>;
  let accessTokenService: AccessTokenService;
  let secret: string;
  let activeCustomerId: string;
  let lockedCustomerId: string;
  let mismatchCustomerId: string;
  let sequence = 0;

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
    customerRepo = dataSource.getRepository(Customer);
    accessTokenService = app.get(AccessTokenService);
    secret = app
      .get(ConfigService)
      .getOrThrow<string>('JWT_ACCESS_TOKEN_SECRET');

    const passwordHash = await app.get(PasswordHasherService).hash(PASSWORD);

    const customers = await customerRepo.save(
      [
        { status: 'ACTIVE' as const, tokenVersion: 3 },
        { status: 'LOCKED' as const, tokenVersion: 2 },
        { status: 'ACTIVE' as const, tokenVersion: 9 },
      ].map((overrides, index) =>
        customerRepo.create({
          fullName: `Auth Error Contract ${index}`,
          email: nextEmail(index),
          phone: nextPhone(),
          passwordHash,
          ...overrides,
        }),
      ),
    );

    [activeCustomerId, lockedCustomerId, mismatchCustomerId] = customers.map(
      (customer) => customer.id,
    );

    e2eHarness.registerCleanup(async () => {
      await customerRepo.delete(customers.map((c) => c.id));
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

  describe('strict Bearer header failures', () => {
    it.each(BEARER_HEADER_REJECTIONS)(
      'rejects %s with the legacy required-header error',
      async (_name, header) => {
        const authorization =
          header === 'undefined-marker' ? undefined : header;

        const httpRequest = request(app.getHttpServer()).get('/api/v1/auth/me');
        if (authorization !== undefined) {
          httpRequest.set('Authorization', authorization);
        }
        const response = await httpRequest;

        expect(response.status).toBe(401);
        expect(response.body).toMatchObject({
          success: false,
          statusCode: 401,
          ...UNAUTHORIZED_FALLBACK,
          message: 'Authorization bearer token is required.',
        });
      },
    );
  });

  describe('JWT cryptographic failures (passport-jwt/jsonwebtoken)', () => {
    it('rejects a malformed token with the legacy invalid-token error', async () => {
      const response = await sendBearer('not-a-jwt');

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        statusCode: 401,
        ...UNAUTHORIZED_FALLBACK,
        message: 'Invalid access token.',
      });
    });

    it.each(NORMALIZED_BEARER_HEADERS)(
      'keeps the legacy invalid-token result for %s after HTTP normalization',
      async (_name, header) => {
        const httpRequest = request(app.getHttpServer())
          .get('/api/v1/auth/me')
          .set('Authorization', header);
        const response = await httpRequest;

        expect(response.status).toBe(401);
        expect(response.body).toMatchObject({
          statusCode: 401,
          ...UNAUTHORIZED_FALLBACK,
          message: 'Invalid access token.',
        });
      },
    );

    it('rejects a wrong signature with the legacy invalid-token error', async () => {
      const token = validCustomerToken();
      const tampered = `${token.slice(0, -1)}x`;

      const response = await sendBearer(tampered);

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        statusCode: 401,
        ...UNAUTHORIZED_FALLBACK,
        message: 'Invalid access token.',
      });
    });

    it('rejects a wrong algorithm with the legacy invalid-token error', async () => {
      const now = Math.floor(Date.now() / 1000);
      const header = { alg: 'HS512', typ: 'JWT' };
      const payload = {
        sub: `customer:${activeCustomerId}`,
        actor_type: 'customer',
        customer_id: activeCustomerId,
        token_version: 3,
        iat: now,
        exp: now + 900,
      };
      const token = signSegments(header, payload);

      const response = await sendBearer(token);

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        statusCode: 401,
        ...UNAUTHORIZED_FALLBACK,
        message: 'Invalid access token.',
      });
    });
  });

  describe('strategy/application authentication errors', () => {
    it('rejects a wrong typ header with the legacy invalid-token error', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = signSegments(
        { alg: 'HS256', typ: 'JWS' },
        {
          sub: `customer:${activeCustomerId}`,
          actor_type: 'customer',
          customer_id: activeCustomerId,
          token_version: 3,
          iat: now,
          exp: now + 900,
        },
      );

      const response = await sendBearer(token);

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        statusCode: 401,
        ...UNAUTHORIZED_FALLBACK,
        message: 'Invalid access token.',
      });
    });

    it('rejects an expired token with the dedicated expired message', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = signSegments(
        { alg: 'HS256', typ: 'JWT' },
        {
          sub: `customer:${activeCustomerId}`,
          actor_type: 'customer',
          customer_id: activeCustomerId,
          token_version: 3,
          iat: now - 900,
          exp: now - 1,
        },
      );

      const response = await sendBearer(token);

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        statusCode: 401,
        ...UNAUTHORIZED_FALLBACK,
        message: 'Access token has expired.',
      });
    });

    it('rejects iat 61 seconds in the future with the invalid-token error', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = signSegments(
        { alg: 'HS256', typ: 'JWT' },
        {
          sub: `customer:${activeCustomerId}`,
          actor_type: 'customer',
          customer_id: activeCustomerId,
          token_version: 3,
          iat: now + 61,
          exp: now + 900,
        },
      );

      const response = await sendBearer(token);

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        statusCode: 401,
        ...UNAUTHORIZED_FALLBACK,
        message: 'Invalid access token.',
      });
    });

    it('rejects a token-version mismatch with the invalid-token error', async () => {
      const token = accessTokenService.sign({
        actorType: 'customer',
        customerId: mismatchCustomerId,
        tokenVersion: 8, // DB holds 9
      });

      const response = await sendBearer(token);

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        statusCode: 401,
        ...UNAUTHORIZED_FALLBACK,
        message: 'Invalid access token.',
      });
    });

    it('rejects a locked account with the legacy 403', async () => {
      const token = accessTokenService.sign({
        actorType: 'customer',
        customerId: lockedCustomerId,
        tokenVersion: 2,
      });

      const response = await sendBearer(token);

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        success: false,
        statusCode: 403,
        errorCode: 'COMMON_FORBIDDEN',
        error: 'Forbidden',
        message: 'Tai khoan bi khoa.',
      });
    });
  });

  describe('unexpected system failures', () => {
    it('propagates a reader database failure as 5xx, never as 401', async () => {
      const reader = app.get(CustomerAuthorizationReader);
      const originalFindById = reader.findById.bind(reader);
      reader.findById = async (id: string) => {
        if (id === SYSTEM_ERROR_CUSTOMER_ID) {
          throw new Error('db connection lost');
        }

        return originalFindById(id);
      };

      try {
        const token = accessTokenService.sign({
          actorType: 'customer',
          customerId: SYSTEM_ERROR_CUSTOMER_ID,
          tokenVersion: 0,
        });

        const response = await sendBearer(token);

        expect(response.status).toBeGreaterThanOrEqual(500);
        expect(response.status).not.toBe(401);
        expect(response.body).toMatchObject({
          success: false,
          statusCode: 500,
          errorCode: 'COMMON_INTERNAL_ERROR',
          error: 'Internal Server Error',
          message: 'Internal server error.',
        });
      } finally {
        reader.findById = originalFindById;
      }
    });
  });

  describe('positive control', () => {
    it('still authenticates a fully valid request end to end', async () => {
      const token = accessTokenService.sign({
        actorType: 'customer',
        customerId: activeCustomerId,
        tokenVersion: 3,
      });

      const response = await sendBearer(token);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        statusCode: 200,
        data: {
          actorType: 'customer',
          customer: { id: activeCustomerId },
        },
      });
    });
  });

  function validCustomerToken(): string {
    return accessTokenService.sign({
      actorType: 'customer',
      customerId: activeCustomerId,
      tokenVersion: 3,
    });
  }

  function sendBearer(token: string) {
    return request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
  }

  function signSegments(
    header: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): string {
    const encodedHeader = Buffer.from(JSON.stringify(header), 'utf8').toString(
      'base64url',
    );
    const encodedPayload = Buffer.from(
      JSON.stringify(payload),
      'utf8',
    ).toString('base64url');
    const signature = createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  function nextEmail(index: number): string {
    sequence += 1;

    return `auth-error-contract-${UNIQUE_SUFFIX}-${sequence}-${index}@example.com`;
  }

  function nextPhone(): string {
    sequence += 1;
    const suffix = String((Date.now() + sequence * 97) % 100_000_000).padStart(
      8,
      '0',
    );

    return `+849${suffix}`;
  }
});
