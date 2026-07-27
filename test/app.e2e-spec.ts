import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import sharp from 'sharp';
import { DataSource, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/http';
import { assertSafeE2eEnvironment } from '../src/config/e2e-environment';
import migrationDataSource from '../src/database/data-source';
import { AccessTokenService } from '../src/module/auth/access-token.service';
import { PasswordHasherService } from '../src/module/auth/password-hasher.service';
import { Amenity } from '../src/module/amenity/schema/amenity.entity';
import { Booking } from '../src/module/booking/schema/booking.entity';
import { RoomCalendar } from '../src/module/booking/schema/room-calendar.entity';
import { BookingService } from '../src/module/booking/booking.service';
import { Customer } from '../src/module/customer/schema/customer.entity';
import { Payment } from '../src/module/payment/schema/payment.entity';
import { PaymentService } from '../src/module/payment/payment.service';
import {
  createVnPaySignature,
  formatVnPayDate,
  VnPayGatewayService,
} from '../src/module/payment/vnpay-gateway.service';
import { RoomType } from '../src/module/room-type/schema/room-type.entity';
import { RoomImageStorageService } from '../src/module/room/room-image-storage.service';
import { RoomImage } from '../src/module/room/schema/room-image.entity';
import { Room } from '../src/module/room/schema/room.entity';
import { User } from '../src/module/user/schema/user.entity';
import { createOpenApiDocument } from '../src/openapi/openapi';

interface ApiResponseBody<TData> {
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
}

interface RoomTypeBody {
  id: string;
  name: string;
  description: string | null;
  maxGuests: number;
  basePrice: string;
  amenities: AmenityBody[];
  deletedAt?: string | null;
}

interface AmenityBody {
  id: string;
  name: string;
  description: string | null;
  deletedAt?: string | null;
}

interface UserBody {
  id: string;
  phone: string | null;
  role: 'ADMIN' | 'STAFF';
  status: 'ACTIVE' | 'LOCKED';
}

interface CustomerBody {
  id: string;
  phone: string;
  status: 'ACTIVE' | 'LOCKED';
}

interface LoginBody {
  accessToken: string;
}

interface RoomImageBody {
  id: string;
  imageUrl: string;
  sortOrder: number;
  isCover: boolean;
}

interface RoomBody {
  id: string;
  roomTypeId: string;
  roomNumber: string;
  name: string;
  description: string | null;
  status: string;
  images: RoomImageBody[];
}

interface RoomCalendarBody {
  id: string;
  stayDate: string;
  status: 'RESERVED' | 'BLOCKED';
  reason: string | null;
  booking: {
    id: string;
    bookingCode: string;
  } | null;
}

interface BookingBody {
  id: string;
  bookingCode: string;
  customerId: string;
  roomId: string;
  createdByUserId: string | null;
  checkInDate: string;
  checkOutDate: string;
  guestCount: number;
  contactPhone: string;
  totalAmount: string;
  status: string;
  paymentStatus: string;
  paymentExpiresAt: string | null;
  createdAt: string;
  customer: {
    id: string;
    fullName: string;
    phone: string;
  };
}

interface PaymentBody {
  id: string;
  bookingId: string;
  amount: string;
  currency: string;
  method: string;
  status: string;
  gatewayName: string | null;
  gatewayReference: string | null;
  gatewayTransactionId: string | null;
  gatewayResponseCode: string | null;
  gatewayTransactionStatus: string | null;
  gatewayTransactionDate: string | null;
  refundRequestId: string | null;
  refundPreviousStatus: string | null;
  refundGatewayTransactionId: string | null;
  refundResponseCode: string | null;
  refundTransactionStatus: string | null;
  refundMessage: string | null;
  refundReason: string | null;
  createdByUserId: string | null;
  refundedByUserId: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  refundRequestedAt: string | null;
  refundLastQueriedAt: string | null;
  expiresAt: string | null;
}

interface OnlinePaymentBody {
  payment: PaymentBody;
  paymentUrl: string;
  expiresAt: string;
}

let testRoomImage: Buffer;

describe('Application API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let customersRepository: Repository<Customer>;
  let usersRepository: Repository<User>;
  let amenitiesRepository: Repository<Amenity>;
  let roomTypesRepository: Repository<RoomType>;
  let roomsRepository: Repository<Room>;
  let roomImagesRepository: Repository<RoomImage>;
  let bookingsRepository: Repository<Booking>;
  let roomCalendarRepository: Repository<RoomCalendar>;
  let paymentsRepository: Repository<Payment>;
  let vnPayGatewayService: VnPayGatewayService;
  let adminToken: string;
  let customerToken: string | undefined;
  let staffToken: string | undefined;
  let testAdminId: string | undefined;
  let testCustomerId: string | undefined;
  let testStaffId: string | undefined;
  const testAmenityIds: string[] = [];
  let testRoomTypeId: string | undefined;
  let testRoomId: string | undefined;
  let testRoomNumber: string | undefined;
  const counterCustomerIds: string[] = [];
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const roomTypeName = `E2E Room Type ${uniqueSuffix}`;

  beforeAll(async () => {
    testRoomImage = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: '#336699',
      },
    })
      .png()
      .toBuffer();

    assertSafeE2eEnvironment(process.env);
    await migrationDataSource.initialize();
    await migrationDataSource.runMigrations();
    await migrationDataSource.destroy();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    customersRepository = dataSource.getRepository(Customer);
    usersRepository = dataSource.getRepository(User);
    amenitiesRepository = dataSource.getRepository(Amenity);
    roomTypesRepository = dataSource.getRepository(RoomType);
    roomsRepository = dataSource.getRepository(Room);
    roomImagesRepository = dataSource.getRepository(RoomImage);
    bookingsRepository = dataSource.getRepository(Booking);
    roomCalendarRepository = dataSource.getRepository(RoomCalendar);
    paymentsRepository = dataSource.getRepository(Payment);
    vnPayGatewayService = app.get(VnPayGatewayService);

    const testAdmin = await usersRepository.save(
      usersRepository.create({
        fullName: 'E2E Administrator',
        email: `e2e-admin-${uniqueSuffix}@example.com`,
        phone: null,
        passwordHash: 'not-used-by-this-test',
        role: 'ADMIN',
        status: 'ACTIVE',
      }),
    );
    testAdminId = testAdmin.id;
    adminToken = app.get(AccessTokenService).sign({
      actorType: 'user',
      userId: testAdmin.id,
      role: 'ADMIN',
      tokenVersion: testAdmin.tokenVersion,
    });
  });

  it('matches the committed OpenAPI contract snapshot', () => {
    const snapshot = JSON.parse(
      readFileSync(resolve(process.cwd(), 'docs/openapi.json'), 'utf8'),
    ) as unknown;

    expect(createOpenApiDocument(app)).toEqual(snapshot);
  });

  it('publishes typed request examples instead of empty OpenAPI schemas', () => {
    const document = createOpenApiDocument(app);
    const schemas = document.components?.schemas as
      | Record<
          string,
          {
            properties?: Record<
              string,
              {
                example?: unknown;
                format?: string;
                type?: string;
              }
            >;
          }
        >
      | undefined;

    expect(schemas).toBeDefined();

    const requestSchemaNames = new Set<string>();

    for (const pathItemValue of Object.values(
      document.paths as Record<string, unknown>,
    )) {
      if (typeof pathItemValue !== 'object' || pathItemValue === null) {
        continue;
      }

      for (const operation of Object.values(
        pathItemValue as Record<string, unknown>,
      )) {
        if (
          typeof operation !== 'object' ||
          operation === null ||
          !('requestBody' in operation)
        ) {
          continue;
        }

        const requestBody = (operation as Record<string, unknown>)
          .requestBody as
          | {
              content?: Record<
                string,
                { schema?: { $ref?: string; properties?: object } }
              >;
            }
          | undefined;
        const schema = requestBody?.content?.['application/json']?.schema;
        const reference = schema?.$ref;

        if (reference !== undefined) {
          requestSchemaNames.add(reference.split('/').at(-1) ?? '');
        }
      }
    }

    expect(requestSchemaNames.size).toBeGreaterThan(0);

    for (const schemaName of requestSchemaNames) {
      expect(
        Object.keys(schemas?.[schemaName]?.properties ?? {}),
      ).not.toHaveLength(0);
    }

    expect(schemas?.RegisterCustomerDto?.properties).toMatchObject({
      fullName: { example: 'Pham Van Tan', type: 'string' },
      password: { example: 'StrongPassword123!', type: 'string' },
      phone: { example: '0705840355', type: 'string' },
    });
    expect(schemas?.LoginDto?.properties?.identifier).toMatchObject({
      example: 'tan@example.com',
      type: 'string',
    });
    expect(schemas?.LoginDto?.properties?.password).toMatchObject({
      example: 'StrongPassword123!',
      type: 'string',
    });
    expect(schemas?.CreateBookingDto?.properties?.checkInDate).toMatchObject({
      example: '2026-08-01',
      format: 'date',
      type: 'string',
    });

    const roomImageUpload = document.paths['/api/v1/rooms/{roomId}/images']
      ?.post?.requestBody as
      | {
          content?: {
            'multipart/form-data'?: {
              schema?: {
                properties?: Record<string, { format?: string; type?: string }>;
              };
            };
          };
        }
      | undefined;

    expect(
      roomImageUpload?.content?.['multipart/form-data']?.schema?.properties
        ?.file,
    ).toEqual({
      format: 'binary',
      type: 'string',
    });
  });

  it('uses the real API prefix and shared response format', async () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.DB_DATABASE).toMatch(/_test$/);

    const response = await request(app.getHttpServer()).get('/api').expect(200);
    const body = response.body as ApiResponseBody<string>;

    expect(body).toMatchObject({
      success: true,
      statusCode: 200,
      message: 'Thanh cong.',
      data: 'Hello World!',
      path: '/api',
    });
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it('protects the admin RoomType API', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/room-types')
      .expect(401);
    const body = response.body as ApiResponseBody<null>;

    expect(body.success).toBe(false);
    expect(body.path).toBe('/api/v1/admin/room-types');
  });

  it('keeps Room reads public while protecting writes on the same resource', async () => {
    await request(app.getHttpServer()).get('/api/v1/rooms').expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/rooms')
      .send({})
      .expect(401);
  });

  it('issues STAFF accounts, protects admin, and revokes tokens after password reset', async () => {
    const staffEmail = `e2e-staff-${uniqueSuffix}@example.com`;
    const staffPhone = `090${String(Date.now()).slice(-7)}`;
    const formattedStaffPhone = `${staffPhone.slice(0, 4)}-${staffPhone.slice(4, 7)}-${staffPhone.slice(7)}`;
    const canonicalStaffPhone = `+84${staffPhone.slice(1)}`;
    const initialPassword = 'StrongPassword123!';
    const resetPassword = 'ResetPassword456!';

    await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Rejected E2E Administrator',
        email: `rejected-admin-${uniqueSuffix}@example.com`,
        password: 'StrongPassword123!',
        role: 'ADMIN',
      })
      .expect(400);

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'E2E Staff',
        email: staffEmail,
        phone: formattedStaffPhone,
        password: initialPassword,
      })
      .expect(201);
    const createBody = createResponse.body as ApiResponseBody<UserBody>;

    expect(createBody.data.role).toBe('STAFF');
    expect(createBody.data.phone).toBe(canonicalStaffPhone);
    testStaffId = createBody.data.id;
    staffToken = app.get(AccessTokenService).sign({
      actorType: 'user',
      userId: createBody.data.id,
      role: 'STAFF',
      tokenVersion: 0,
    });

    await request(app.getHttpServer())
      .get('/api/v1/management/rooms')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/users/${testAdminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'STAFF' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/v1/users/${testAdminId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'LOCKED' })
      .expect(400);

    const userBeforeReset = await usersRepository.findOneByOrFail({
      id: testStaffId,
    });

    expect(userBeforeReset.tokenVersion).toBe(0);

    await request(app.getHttpServer())
      .patch(`/api/v1/users/${testStaffId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: resetPassword })
      .expect(200);

    const userAfterReset = await usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id: testStaffId })
      .getOneOrFail();

    expect(userAfterReset.tokenVersion).toBe(1);
    await expect(
      app
        .get(PasswordHasherService)
        .verify(resetPassword, userAfterReset.passwordHash),
    ).resolves.toBe(true);

    await request(app.getHttpServer())
      .get('/api/v1/management/rooms')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(401);

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/users/login')
      .send({
        identifier: canonicalStaffPhone.slice(1),
        password: resetPassword,
      })
      .expect(200);
    const loginBody = loginResponse.body as ApiResponseBody<LoginBody>;

    staffToken = loginBody.data.accessToken;

    await request(app.getHttpServer())
      .get('/api/v1/management/rooms')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

    const lockResponse = await request(app.getHttpServer())
      .patch(`/api/v1/users/${testStaffId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'LOCKED' })
      .expect(200);
    const lockBody = lockResponse.body as ApiResponseBody<UserBody>;

    expect(lockBody.data.status).toBe('LOCKED');

    await request(app.getHttpServer())
      .patch(`/api/v1/users/${testStaffId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);
  });

  it('rate-limits repeated user login attempts', async () => {
    for (let attempt = 1; attempt <= 9; attempt += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/users/login')
        .send({
          identifier: `missing-${uniqueSuffix}@example.com`,
          password: 'incorrect-password',
        })
        .expect(401);
    }

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/users/login')
      .send({
        identifier: `missing-${uniqueSuffix}@example.com`,
        password: 'incorrect-password',
      })
      .expect(429);

    expect(response.headers['retry-after']).toEqual(expect.any(String));
  });

  it('manages customer status on the shared customer resource', async () => {
    const customerEmail = `e2e-customer-${uniqueSuffix}@example.com`;
    const customerPhone = `070${String(Date.now()).slice(-7)}`;
    const formattedCustomerPhone = `${customerPhone.slice(0, 4)} ${customerPhone.slice(4, 7)} ${customerPhone.slice(7)}`;
    const canonicalCustomerPhone = `+84${customerPhone.slice(1)}`;
    const registerResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/customers/register')
      .send({
        fullName: 'E2E Customer',
        email: customerEmail,
        phone: formattedCustomerPhone,
        password: 'StrongPassword123!',
      })
      .expect(201);
    const registerBody = registerResponse.body as ApiResponseBody<CustomerBody>;

    expect(registerBody.data.phone).toBe(canonicalCustomerPhone);
    testCustomerId = registerBody.data.id;

    await request(app.getHttpServer())
      .post('/api/v1/auth/customers/register')
      .send({
        fullName: 'Duplicate E2E Customer',
        email: `duplicate-${customerEmail}`,
        phone: canonicalCustomerPhone,
        password: 'StrongPassword123!',
      })
      .expect(409);

    const lockResponse = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${testCustomerId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'LOCKED' })
      .expect(200);
    const lockBody = lockResponse.body as ApiResponseBody<CustomerBody>;

    expect(lockBody.data.status).toBe('LOCKED');

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${testCustomerId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/customers/login')
      .send({
        identifier: formattedCustomerPhone,
        password: 'StrongPassword123!',
      })
      .expect(200);
    const loginBody = loginResponse.body as ApiResponseBody<LoginBody>;
    customerToken = loginBody.data.accessToken;

    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${testCustomerId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'LOCKED' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${testCustomerId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    const customerBeforePasswordChange =
      await customersRepository.findOneByOrFail({
        id: testCustomerId,
      });

    expect(customerBeforePasswordChange.tokenVersion).toBe(0);

    await request(app.getHttpServer())
      .patch('/api/v1/customers/me/password')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        currentPassword: 'WrongPassword123!',
        newPassword: 'UpdatedCustomerPassword456!',
      })
      .expect(400);
    expect(
      (await customersRepository.findOneByOrFail({ id: testCustomerId }))
        .tokenVersion,
    ).toBe(0);

    await request(app.getHttpServer())
      .patch('/api/v1/customers/me/password')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        currentPassword: 'StrongPassword123!',
        newPassword: 'UpdatedCustomerPassword456!',
      })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/customers/login')
      .send({
        identifier: formattedCustomerPhone,
        password: 'StrongPassword123!',
      })
      .expect(401);

    const reloginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/customers/login')
      .send({
        identifier: formattedCustomerPhone,
        password: 'UpdatedCustomerPassword456!',
      })
      .expect(200);
    const reloginBody = reloginResponse.body as ApiResponseBody<LoginBody>;

    customerToken = reloginBody.data.accessToken;

    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    const customerAfterPasswordChange = await customersRepository
      .createQueryBuilder('customer')
      .addSelect('customer.passwordHash')
      .where('customer.id = :id', { id: testCustomerId })
      .getOneOrFail();

    expect(customerAfterPasswordChange.tokenVersion).toBe(1);
    await expect(
      app
        .get(PasswordHasherService)
        .verify(
          'UpdatedCustomerPassword456!',
          customerAfterPasswordChange.passwordHash,
        ),
    ).resolves.toBe(true);
  });

  it('creates a RoomType and rejects duplicate names', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/room-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `  ${roomTypeName}  `,
        description: '  Room type created by the e2e suite.  ',
        maxGuests: 4,
        basePrice: '1250000.5',
      })
      .expect(201);
    const createBody = createResponse.body as ApiResponseBody<RoomTypeBody>;

    expect(createBody.data).toMatchObject({
      name: roomTypeName,
      description: 'Room type created by the e2e suite.',
      maxGuests: 4,
      basePrice: '1250000.50',
      deletedAt: null,
    });
    testRoomTypeId = createBody.data.id;

    await request(app.getHttpServer())
      .post('/api/v1/admin/room-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: roomTypeName.toLowerCase(),
        maxGuests: 2,
        basePrice: 100000,
      })
      .expect(409);
  });

  it('reads and validates RoomType updates', async () => {
    const id = requireTestRoomTypeId();
    const publicResponse = await request(app.getHttpServer())
      .get(`/api/v1/room-types/${id}`)
      .expect(200);
    const publicBody = publicResponse.body as ApiResponseBody<RoomTypeBody>;

    expect(publicBody.data.basePrice).toBe('1250000.50');
    expect(publicBody.data).not.toHaveProperty('deletedAt');

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/room-types/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);

    const updateResponse = await request(app.getHttpServer())
      .patch(`/api/v1/admin/room-types/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        description: '',
        maxGuests: 5,
        basePrice: '1350000',
      })
      .expect(200);
    const updateBody = updateResponse.body as ApiResponseBody<RoomTypeBody>;

    expect(updateBody.data).toMatchObject({
      description: null,
      maxGuests: 5,
      basePrice: '1350000.00',
    });
  });

  it('manages amenities and assigns an exact active set to a RoomType', async () => {
    const roomTypeId = requireTestRoomTypeId();
    const amenityNames = [
      `E2E WiFi ${uniqueSuffix}`,
      `E2E Air Conditioner ${uniqueSuffix}`,
      `E2E Balcony ${uniqueSuffix}`,
    ];

    await request(app.getHttpServer())
      .get('/api/v1/admin/amenities')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/amenities')
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .expect(403);

    for (const [index, name] of amenityNames.entries()) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/amenities')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `  ${name}  `,
          description: index === 0 ? '  Fast wireless internet.  ' : null,
        })
        .expect(201);
      const body = response.body as ApiResponseBody<AmenityBody>;

      expect(body.data.name).toBe(name);
      if (index === 0) {
        expect(body.data.description).toBe('Fast wireless internet.');
      }
      testAmenityIds.push(body.data.id);
    }

    await request(app.getHttpServer())
      .post('/api/v1/admin/amenities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: amenityNames[0].toLowerCase() })
      .expect(409);

    const assignResponse = await request(app.getHttpServer())
      .put(`/api/v1/admin/room-types/${roomTypeId}/amenities`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amenityIds: testAmenityIds.slice(0, 2) })
      .expect(200);
    const assignBody = assignResponse.body as ApiResponseBody<RoomTypeBody>;

    expect(
      assignBody.data.amenities.map((amenity) => amenity.id).sort(),
    ).toEqual(testAmenityIds.slice(0, 2).sort());

    await request(app.getHttpServer())
      .put(`/api/v1/admin/room-types/${roomTypeId}/amenities`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amenityIds: [testAmenityIds[0], testAmenityIds[0]] })
      .expect(400);

    await request(app.getHttpServer())
      .put(`/api/v1/admin/room-types/${roomTypeId}/amenities`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amenityIds: [testAmenityIds[0], '999999999999'] })
      .expect(400);

    const unchangedResponse = await request(app.getHttpServer())
      .get(`/api/v1/room-types/${roomTypeId}`)
      .expect(200);
    const unchangedBody =
      unchangedResponse.body as ApiResponseBody<RoomTypeBody>;
    expect(
      unchangedBody.data.amenities.map((amenity) => amenity.id).sort(),
    ).toEqual(testAmenityIds.slice(0, 2).sort());

    const publicListResponse = await request(app.getHttpServer())
      .get('/api/v1/amenities')
      .query({ search: uniqueSuffix, limit: 10 })
      .expect(200);
    const publicListBody = publicListResponse.body as ApiResponseBody<
      AmenityBody[]
    >;
    expect(publicListBody.data).toHaveLength(3);

    const deletedAmenityId = testAmenityIds[1];
    const deleteResponse = await request(app.getHttpServer())
      .delete(`/api/v1/admin/amenities/${deletedAmenityId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const deleteBody = deleteResponse.body as ApiResponseBody<AmenityBody>;
    expect(deleteBody.data.deletedAt).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .get(`/api/v1/amenities/${deletedAmenityId}`)
      .expect(404);

    const hiddenRelationResponse = await request(app.getHttpServer())
      .get(`/api/v1/room-types/${roomTypeId}`)
      .expect(200);
    const hiddenRelationBody =
      hiddenRelationResponse.body as ApiResponseBody<RoomTypeBody>;
    expect(
      hiddenRelationBody.data.amenities.map((amenity) => amenity.id),
    ).toEqual([testAmenityIds[0]]);

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/amenities/${deletedAmenityId}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const restoredResponse = await request(app.getHttpServer())
      .get(`/api/v1/room-types/${roomTypeId}`)
      .expect(200);
    const restoredBody = restoredResponse.body as ApiResponseBody<RoomTypeBody>;
    expect(
      restoredBody.data.amenities.map((amenity) => amenity.id).sort(),
    ).toEqual(testAmenityIds.slice(0, 2).sort());
  });

  it('soft-deletes, lists, and restores a RoomType', async () => {
    const id = requireTestRoomTypeId();
    const deleteResponse = await request(app.getHttpServer())
      .delete(`/api/v1/admin/room-types/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const deleteBody = deleteResponse.body as ApiResponseBody<RoomTypeBody>;

    expect(deleteBody.data.deletedAt).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .get(`/api/v1/room-types/${id}`)
      .expect(404);

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/admin/room-types')
      .query({ includeDeleted: 'true', search: roomTypeName })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const listBody = listResponse.body as ApiResponseBody<RoomTypeBody[]>;

    expect(listBody.data.some((item) => item.id === id)).toBe(true);
    expect(listBody.meta?.pagination.total).toBeGreaterThanOrEqual(1);

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/room-types/${id}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/room-types/${id}`)
      .expect(200);
  });

  it('refuses to delete a RoomType used by an active room', async () => {
    const id = requireTestRoomTypeId();
    testRoomNumber = `E2E-${uniqueSuffix}`;

    await dataSource.query(
      'INSERT INTO rooms (room_type_id, room_number, name) VALUES (?, ?, ?)',
      [id, testRoomNumber, `E2E Room ${uniqueSuffix}`],
    );

    await request(app.getHttpServer())
      .delete(`/api/v1/admin/room-types/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    await dataSource.query('DELETE FROM rooms WHERE room_number = ?', [
      testRoomNumber,
    ]);
    testRoomNumber = undefined;
  });

  it('creates, lists, and updates a room', async () => {
    const roomTypeId = requireTestRoomTypeId();
    testRoomNumber = `E2E-${uniqueSuffix}`;

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        roomTypeId,
        roomNumber: testRoomNumber,
        name: `E2E Room ${uniqueSuffix}`,
        description: '  Initial room description.  ',
      })
      .expect(201);
    const createBody = createResponse.body as ApiResponseBody<RoomBody>;

    expect(createBody.data).toMatchObject({
      roomTypeId,
      roomNumber: testRoomNumber,
      description: 'Initial room description.',
      status: 'READY',
      images: [],
    });
    testRoomId = createBody.data.id;

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/rooms')
      .query({ search: testRoomNumber })
      .expect(200);
    const listBody = listResponse.body as ApiResponseBody<RoomBody[]>;

    expect(listBody.data.map((room) => room.id)).toContain(testRoomId);

    const updateResponse = await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${testRoomId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: '', name: `Updated E2E Room ${uniqueSuffix}` })
      .expect(200);
    const updateBody = updateResponse.body as ApiResponseBody<RoomBody>;

    expect(updateBody.data.description).toBeNull();
    expect(updateBody.data.name).toBe(`Updated E2E Room ${uniqueSuffix}`);
  });

  it('filters rooms that contain every selected active amenity', async () => {
    const roomId = requireTestRoomId();

    const matchingResponse = await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({
        checkIn: '2031-06-01',
        checkOut: '2031-06-03',
        guests: 2,
        amenityIds: testAmenityIds.slice(0, 2),
      })
      .expect(200);
    const matchingBody = matchingResponse.body as ApiResponseBody<RoomBody[]>;
    expect(matchingBody.data.map((room) => room.id)).toContain(roomId);

    const nonMatchingResponse = await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({
        checkIn: '2031-06-01',
        checkOut: '2031-06-03',
        guests: 2,
        amenityIds: [testAmenityIds[0], testAmenityIds[2]],
      })
      .expect(200);
    const nonMatchingBody = nonMatchingResponse.body as ApiResponseBody<
      RoomBody[]
    >;
    expect(nonMatchingBody.data.map((room) => room.id)).not.toContain(roomId);

    await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({
        checkIn: '2031-06-01',
        checkOut: '2031-06-03',
        guests: 2,
        amenityIds: `${testAmenityIds[0]},${testAmenityIds[1]}`,
      })
      .expect(200);
  });

  it('manages room images and always keeps a cover when images remain', async () => {
    const roomId = requireTestRoomId();

    await request(app.getHttpServer())
      .post(`/api/v1/rooms/${roomId}/images`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sortOrder: 2 })
      .expect(400);

    const firstResponse = await request(app.getHttpServer())
      .post(`/api/v1/rooms/${roomId}/images`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('sortOrder', '2')
      .field('isCover', 'false')
      .attach('file', testRoomImage, {
        filename: 'room-1.png',
        contentType: 'image/png',
      })
      .expect(201);
    const firstBody = firstResponse.body as ApiResponseBody<RoomImageBody>;

    expect(firstBody.data.isCover).toBe(true);
    expect(firstBody.data.imageUrl).toMatch(
      new RegExp(`^/media/room-images/${roomId}/[0-9a-f-]{36}\\.webp$`),
    );
    await request(app.getHttpServer())
      .get(firstBody.data.imageUrl)
      .expect('Content-Type', /image\/webp/)
      .expect('X-Content-Type-Options', 'nosniff')
      .expect(200);

    const secondResponse = await request(app.getHttpServer())
      .post(`/api/v1/rooms/${roomId}/images`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('sortOrder', '1')
      .attach('file', testRoomImage, {
        filename: 'room-2.png',
        contentType: 'image/png',
      })
      .expect(201);
    const secondBody = secondResponse.body as ApiResponseBody<RoomImageBody>;

    expect(secondBody.data.isCover).toBe(false);

    await request(app.getHttpServer())
      .patch(`/api/v1/room-images/${secondBody.data.id}/set-cover`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const roomResponse = await request(app.getHttpServer())
      .get(`/api/v1/rooms/${roomId}`)
      .expect(200);
    const roomBody = roomResponse.body as ApiResponseBody<RoomBody>;

    expect(roomBody.data.images[0]).toMatchObject({
      id: secondBody.data.id,
      isCover: true,
    });

    await request(app.getHttpServer())
      .delete(`/api/v1/room-images/${secondBody.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(secondBody.data.imageUrl)
      .expect(404);
    const remainingImage = await roomImagesRepository.findOneBy({
      id: firstBody.data.id,
    });
    expect(remainingImage?.isCover).toBe(true);
  });

  it('serializes concurrent creation of the first room images', async () => {
    const roomId = requireTestRoomId();

    await clearManagedRoomImages(roomId);

    const [firstResponse, secondResponse] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/rooms/${roomId}/images`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', testRoomImage, {
          filename: 'concurrent-room-1.png',
          contentType: 'image/png',
        })
        .expect(201),
      request(app.getHttpServer())
        .post(`/api/v1/rooms/${roomId}/images`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', testRoomImage, {
          filename: 'concurrent-room-2.png',
          contentType: 'image/png',
        })
        .expect(201),
    ]);
    const responseBodies = [
      firstResponse.body as ApiResponseBody<RoomImageBody>,
      secondResponse.body as ApiResponseBody<RoomImageBody>,
    ];
    const images = await roomImagesRepository.findBy({ roomId });

    expect(responseBodies.filter((body) => body.data.isCover)).toHaveLength(1);
    expect(images.filter((image) => image.isCover)).toHaveLength(1);
  });

  it('serializes concurrent room cover changes', async () => {
    const roomId = requireTestRoomId();
    const images = await roomImagesRepository.findBy({ roomId });

    expect(images).toHaveLength(2);

    const responses = await Promise.all(
      images.map((image) =>
        request(app.getHttpServer())
          .patch(`/api/v1/room-images/${image.id}/set-cover`)
          .set('Authorization', `Bearer ${adminToken}`),
      ),
    );
    const updatedImages = await roomImagesRepository.findBy({ roomId });

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(updatedImages.filter((image) => image.isCover)).toHaveLength(1);
  });

  it('searches available rooms and enforces staff status permissions', async () => {
    const roomId = requireTestRoomId();

    const searchResponse = await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({
        checkIn: '2030-06-01',
        checkOut: '2030-06-03',
        guests: 2,
      })
      .expect(200);
    const searchBody = searchResponse.body as ApiResponseBody<RoomBody[]>;

    expect(searchBody.data.map((room) => room.id)).toContain(roomId);

    await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({
        checkIn: '2030-06-03',
        checkOut: '2030-06-01',
        guests: 2,
      })
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/management/rooms')
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/management/rooms')
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${roomId}/status`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({ status: 'HIDDEN' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${roomId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'HIDDEN' })
      .expect(200);

    const hiddenPublicListResponse = await request(app.getHttpServer())
      .get('/api/v1/rooms')
      .query({ search: testRoomNumber })
      .expect(200);
    const hiddenPublicListBody =
      hiddenPublicListResponse.body as ApiResponseBody<RoomBody[]>;

    expect(hiddenPublicListBody.data).toHaveLength(0);

    await request(app.getHttpServer())
      .get(`/api/v1/rooms/${roomId}`)
      .expect(404);

    const hiddenManagementListResponse = await request(app.getHttpServer())
      .get('/api/v1/management/rooms')
      .query({ status: 'HIDDEN' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const hiddenManagementListBody =
      hiddenManagementListResponse.body as ApiResponseBody<RoomBody[]>;

    expect(hiddenManagementListBody.data.map((room) => room.id)).toContain(
      roomId,
    );

    const hiddenManagementDetailResponse = await request(app.getHttpServer())
      .get(`/api/v1/management/rooms/${roomId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const hiddenManagementDetailBody =
      hiddenManagementDetailResponse.body as ApiResponseBody<RoomBody>;

    expect(hiddenManagementDetailBody.data.status).toBe('HIDDEN');

    await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${roomId}/status`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({ status: 'READY' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${roomId}/status`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({ status: 'MAINTENANCE' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${roomId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'READY' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${roomId}/status`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({ status: 'CLEANING' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${roomId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'MAINTENANCE' })
      .expect(200);

    const maintenancePublicListResponse = await request(app.getHttpServer())
      .get('/api/v1/rooms')
      .query({ search: testRoomNumber })
      .expect(200);
    const maintenancePublicListBody =
      maintenancePublicListResponse.body as ApiResponseBody<RoomBody[]>;

    expect(maintenancePublicListBody.data).toHaveLength(0);

    const maintenanceManagementResponse = await request(app.getHttpServer())
      .get('/api/v1/management/rooms')
      .query({ status: 'MAINTENANCE' })
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .expect(200);
    const maintenanceManagementBody =
      maintenanceManagementResponse.body as ApiResponseBody<RoomBody[]>;

    expect(maintenanceManagementBody.data.map((room) => room.id)).toContain(
      roomId,
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${roomId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'READY' })
      .expect(200);
  });

  it('manages blocked room dates without deleting booking reservations', async () => {
    const roomId = requireTestRoomId();
    const blockRange = {
      from: '2030-07-01',
      to: '2030-07-03',
      reason: 'Planned maintenance.',
    };

    await request(app.getHttpServer())
      .get(`/api/v1/management/rooms/${roomId}/calendar`)
      .query({ from: blockRange.from, to: blockRange.to })
      .expect(401);

    await request(app.getHttpServer())
      .get(`/api/v1/management/rooms/${roomId}/calendar`)
      .query({ from: blockRange.from, to: blockRange.to })
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/management/rooms/${roomId}/blocks`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send(blockRange)
      .expect(201)
      .expect((response) => {
        const body = response.body as ApiResponseBody<RoomCalendarBody[]>;

        expect(body.data).toHaveLength(2);
        expect(body.data).toEqual([
          expect.objectContaining({
            stayDate: '2030-07-01',
            status: 'BLOCKED',
            reason: blockRange.reason,
            booking: null,
          }),
          expect.objectContaining({
            stayDate: '2030-07-02',
            status: 'BLOCKED',
            reason: blockRange.reason,
            booking: null,
          }),
        ]);
        expect(body.data.every((entry) => /^\d+$/.test(entry.id))).toBe(true);
      });

    const unavailableResponse = await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({
        checkIn: blockRange.from,
        checkOut: blockRange.to,
        guests: 2,
      })
      .expect(200);
    const unavailableBody = unavailableResponse.body as ApiResponseBody<
      RoomBody[]
    >;

    expect(unavailableBody.data.map((room) => room.id)).not.toContain(roomId);

    await request(app.getHttpServer())
      .post(`/api/v1/management/rooms/${roomId}/blocks`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        from: '2030-07-02',
        to: '2030-07-04',
        reason: 'Overlapping maintenance.',
      })
      .expect(409);

    const rollbackResponse = await request(app.getHttpServer())
      .get(`/api/v1/management/rooms/${roomId}/calendar`)
      .query({ from: '2030-07-01', to: '2030-07-04' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const rollbackBody = rollbackResponse.body as ApiResponseBody<
      RoomCalendarBody[]
    >;

    expect(rollbackBody.data.map((entry) => entry.stayDate)).toEqual([
      '2030-07-01',
      '2030-07-02',
    ]);

    await request(app.getHttpServer())
      .delete(`/api/v1/management/rooms/${roomId}/blocks`)
      .query({ from: blockRange.from, to: blockRange.to })
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/management/rooms/${roomId}/blocks`)
      .query({ from: blockRange.from, to: blockRange.to })
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          data: { removedCount: 2 },
        });
      });

    const availableResponse = await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({
        checkIn: blockRange.from,
        checkOut: blockRange.to,
        guests: 2,
      })
      .expect(200);
    const availableBody = availableResponse.body as ApiResponseBody<RoomBody[]>;

    expect(availableBody.data.map((room) => room.id)).toContain(roomId);

    const bookingResponse = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .send({
        roomId,
        checkInDate: '2030-07-10',
        checkOutDate: '2030-07-12',
        guestCount: 2,
      })
      .expect(201);
    const bookingBody = bookingResponse.body as ApiResponseBody<BookingBody>;

    await request(app.getHttpServer())
      .post(`/api/v1/management/rooms/${roomId}/blocks`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({
        from: '2030-07-09',
        to: '2030-07-11',
        reason: 'Must roll back around a reservation.',
      })
      .expect(409);

    const reservedResponse = await request(app.getHttpServer())
      .get(`/api/v1/management/rooms/${roomId}/calendar`)
      .query({ from: '2030-07-09', to: '2030-07-12' })
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .expect(200);
    const reservedBody = reservedResponse.body as ApiResponseBody<
      RoomCalendarBody[]
    >;

    expect(reservedBody.data).toHaveLength(2);
    expect(reservedBody.data).toEqual([
      expect.objectContaining({
        stayDate: '2030-07-10',
        status: 'RESERVED',
        booking: {
          id: bookingBody.data.id,
          bookingCode: bookingBody.data.bookingCode,
        },
      }),
      expect.objectContaining({
        stayDate: '2030-07-11',
        status: 'RESERVED',
        booking: {
          id: bookingBody.data.id,
          bookingCode: bookingBody.data.bookingCode,
        },
      }),
    ]);

    await request(app.getHttpServer())
      .delete(`/api/v1/management/rooms/${roomId}/blocks`)
      .query({ from: '2030-07-09', to: '2030-07-12' })
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          data: { removedCount: 0 },
        });
      });

    expect(
      await roomCalendarRepository.countBy({
        bookingId: bookingBody.data.id,
      }),
    ).toBe(2);

    await request(app.getHttpServer())
      .patch(`/api/v1/bookings/${bookingBody.data.id}/cancel`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .send({ reason: 'Calendar management E2E cleanup.' })
      .expect(200);

    const concurrentResponses = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/management/rooms/${roomId}/blocks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          from: '2030-07-20',
          to: '2030-07-22',
          reason: 'Concurrent admin block.',
        }),
      request(app.getHttpServer())
        .post(`/api/v1/management/rooms/${roomId}/blocks`)
        .set('Authorization', `Bearer ${requireStaffToken()}`)
        .send({
          from: '2030-07-20',
          to: '2030-07-22',
          reason: 'Concurrent staff block.',
        }),
    ]);

    expect(
      concurrentResponses.map((response) => response.status).sort(),
    ).toEqual([201, 409]);
    expect(
      await roomCalendarRepository.countBy({
        roomId,
        status: 'BLOCKED',
      }),
    ).toBe(2);

    await request(app.getHttpServer())
      .delete(`/api/v1/management/rooms/${roomId}/blocks`)
      .query({ from: '2030-07-20', to: '2030-07-22' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('creates only one concurrent booking and closes its pending VNPay payment on cancellation', async () => {
    const roomId = requireTestRoomId();
    const bookingPayload = {
      roomId,
      checkInDate: '2032-08-01',
      checkOutDate: '2032-08-03',
      guestCount: 2,
      customerNote: 'Concurrent E2E booking',
    };

    await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${roomId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'HIDDEN' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .send(bookingPayload)
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${roomId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'READY' })
      .expect(200);

    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${requireCustomerToken()}`)
        .send(bookingPayload),
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${requireCustomerToken()}`)
        .send(bookingPayload),
    ]);
    const statuses = responses.map((response) => response.status).sort();

    expect(statuses).toEqual([201, 409]);

    const successfulResponse = responses.find(
      (response) => response.status === 201,
    );

    expect(successfulResponse).toBeDefined();

    const successfulBody =
      successfulResponse?.body as ApiResponseBody<BookingBody>;
    const bookingId = successfulBody.data.id;

    expect(successfulBody.data).toMatchObject({
      customerId: testCustomerId,
      roomId,
      checkInDate: '2032-08-01',
      checkOutDate: '2032-08-03',
      guestCount: 2,
      totalAmount: '2700000.00',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'UNPAID',
    });
    expect(successfulBody.data.paymentExpiresAt).toEqual(expect.any(String));
    expect(
      Math.abs(
        Date.parse(successfulBody.timestamp) -
          Date.parse(successfulBody.data.createdAt),
      ),
    ).toBeLessThan(60_000);
    expect(
      await roomCalendarRepository.countBy({
        roomId,
        bookingId,
      }),
    ).toBe(2);
    expect(
      await bookingsRepository.countBy({
        roomId,
        checkInDate: '2032-08-01',
        checkOutDate: '2032-08-03',
      }),
    ).toBe(1);

    const unavailableResponse = await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({
        checkIn: '2032-08-01',
        checkOut: '2032-08-03',
        guests: 2,
      })
      .expect(200);
    const unavailableBody = unavailableResponse.body as ApiResponseBody<
      RoomBody[]
    >;

    expect(unavailableBody.data.map((room) => room.id)).not.toContain(roomId);

    const customerListResponse = await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .expect(200);
    const customerListBody = customerListResponse.body as ApiResponseBody<
      BookingBody[]
    >;

    expect(customerListBody.data.map((booking) => booking.id)).toContain(
      bookingId,
    );

    const pendingPaymentResponse = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/payments`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .set('Idempotency-Key', `cancel-vnpay-${uniqueSuffix}`)
      .send({ locale: 'vn' })
      .expect(201);
    const pendingPaymentBody =
      pendingPaymentResponse.body as ApiResponseBody<OnlinePaymentBody>;

    const cancelResponse = await request(app.getHttpServer())
      .patch(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .send({ reason: 'Customer changed plans.' })
      .expect(200);
    const cancelBody = cancelResponse.body as ApiResponseBody<BookingBody>;

    expect(cancelBody.data.status).toBe('CANCELLED');
    expect(await roomCalendarRepository.countBy({ bookingId })).toBe(0);
    expect(
      await paymentsRepository.findOneByOrFail({
        id: pendingPaymentBody.data.payment.id,
      }),
    ).toMatchObject({
      status: 'FAILED',
      gatewayResponseCode: 'CANCELLED',
    });

    const availableAgainResponse = await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({
        checkIn: '2032-08-01',
        checkOut: '2032-08-03',
        guests: 2,
      })
      .expect(200);
    const availableAgainBody = availableAgainResponse.body as ApiResponseBody<
      RoomBody[]
    >;

    expect(availableAgainBody.data.map((room) => room.id)).toContain(roomId);
  });

  it('allows staff to create and manage a counter booking', async () => {
    const roomId = requireTestRoomId();
    const checkInDate = getVietnamDate(0);
    const checkOutDate = getVietnamDate(2);
    const counterPhone = `098${String(Date.now()).slice(-7)}`;
    const formattedCounterPhone = `${counterPhone.slice(0, 4)} ${counterPhone.slice(4, 7)} ${counterPhone.slice(7)}`;
    const canonicalCounterPhone = `+84${counterPhone.slice(1)}`;

    await request(app.getHttpServer())
      .get('/api/v1/management/bookings')
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/management/bookings')
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/management/bookings')
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({
        customerId: testCustomerId,
        roomId,
        checkInDate: '2032-09-01',
        checkOutDate: '2032-09-03',
        guestCount: 6,
      })
      .expect(400);

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/management/bookings')
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({
        roomId,
        checkInDate,
        checkOutDate,
        guestCount: 3,
        contactName: 'E2E Counter Customer',
        contactPhone: formattedCounterPhone,
        contactEmail: `counter-${uniqueSuffix}@example.com`,
      })
      .expect(201);
    const createBody = createResponse.body as ApiResponseBody<BookingBody>;

    expect(createBody.data).toMatchObject({
      roomId,
      createdByUserId: testStaffId,
      contactPhone: canonicalCounterPhone,
      totalAmount: '2700000.00',
      status: 'PENDING_PAYMENT',
    });

    counterCustomerIds.push(createBody.data.customerId);

    const counterCustomer = await customersRepository
      .createQueryBuilder('customer')
      .addSelect('customer.passwordHash')
      .where('customer.id = :id', { id: createBody.data.customerId })
      .getOneOrFail();

    expect(counterCustomer.phone).toBe(canonicalCounterPhone);
    expect(counterCustomer.passwordHash).toBeNull();
    expect(counterCustomer.tokenVersion).toBe(0);

    await request(app.getHttpServer())
      .patch(
        `/api/v1/management/customers/${createBody.data.customerId}/initial-password`,
      )
      .send({ password: 'CounterCustomerPassword123!' })
      .expect(401);

    await request(app.getHttpServer())
      .patch(
        `/api/v1/management/customers/${createBody.data.customerId}/initial-password`,
      )
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .send({ password: 'CounterCustomerPassword123!' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(
        `/api/v1/management/customers/${createBody.data.customerId}/initial-password`,
      )
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({ password: 'CounterCustomerPassword123!' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(
        `/api/v1/management/customers/${createBody.data.customerId}/initial-password`,
      )
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({ password: 'AnotherCounterPassword456!' })
      .expect(409);

    const counterCustomerWithPassword = await customersRepository
      .createQueryBuilder('customer')
      .addSelect('customer.passwordHash')
      .where('customer.id = :id', { id: createBody.data.customerId })
      .getOneOrFail();

    expect(counterCustomerWithPassword.tokenVersion).toBe(1);
    await expect(
      app
        .get(PasswordHasherService)
        .verify(
          'CounterCustomerPassword123!',
          counterCustomerWithPassword.passwordHash,
        ),
    ).resolves.toBe(true);

    await request(app.getHttpServer())
      .post('/api/v1/auth/customers/login')
      .send({
        identifier: canonicalCounterPhone,
        password: 'CounterCustomerPassword123!',
      })
      .expect(200);

    const managementListResponse = await request(app.getHttpServer())
      .get('/api/v1/management/bookings')
      .query({ search: createBody.data.bookingCode })
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .expect(200);
    const managementListBody = managementListResponse.body as ApiResponseBody<
      BookingBody[]
    >;

    expect(managementListBody.data.map((booking) => booking.id)).toContain(
      createBody.data.id,
    );

    await request(app.getHttpServer())
      .get(`/api/v1/bookings/${createBody.data.id}`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .expect(404);

    const confirmResponse = await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${createBody.data.id}/status`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({ status: 'CONFIRMED' })
      .expect(200);
    const confirmBody = confirmResponse.body as ApiResponseBody<BookingBody>;

    expect(confirmBody.data.status).toBe('CONFIRMED');
    expect(confirmBody.data.paymentExpiresAt).toBeNull();

    await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${createBody.data.id}/status`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({ status: 'CHECKED_IN' })
      .expect(409);

    const counterPaymentResponse = await request(app.getHttpServer())
      .post(`/api/v1/management/bookings/${createBody.data.id}/payments`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .set('Idempotency-Key', `counter-payment-${uniqueSuffix}`)
      .send({ method: 'CASH' })
      .expect(201);
    const counterPaymentBody =
      counterPaymentResponse.body as ApiResponseBody<PaymentBody>;

    expect(counterPaymentBody.data).toMatchObject({
      bookingId: createBody.data.id,
      amount: '2700000.00',
      currency: 'VND',
      method: 'CASH',
      status: 'SUCCESS',
      createdByUserId: testStaffId,
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${createBody.data.id}/status`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({ status: 'CHECKED_IN' })
      .expect(200);
    expect(await roomsRepository.findOneByOrFail({ id: roomId })).toMatchObject(
      {
        status: 'OCCUPIED',
      },
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${createBody.data.id}/status`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({
        status: 'CANCELLED',
        cancellationReason: 'Invalid late cancellation.',
      })
      .expect(409);

    const checkoutResponse = await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${createBody.data.id}/status`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({ status: 'CHECKED_OUT' })
      .expect(200);
    const checkoutBody = checkoutResponse.body as ApiResponseBody<BookingBody>;

    expect(checkoutBody.data.status).toBe('CHECKED_OUT');
    expect(await roomsRepository.findOneByOrFail({ id: roomId })).toMatchObject(
      {
        status: 'CLEANING',
      },
    );
  });

  it('records an idempotent payment, protects paid cancellation, and refunds', async () => {
    const roomId = requireTestRoomId();
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .send({
        roomId,
        checkInDate: '2032-10-10',
        checkOutDate: '2032-10-12',
        guestCount: 2,
      })
      .expect(201);
    const createBody = createResponse.body as ApiResponseBody<BookingBody>;
    const bookingId = createBody.data.id;
    const idempotencyKey = `payment-${uniqueSuffix}`;

    await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({ status: 'CONFIRMED' })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/management/bookings/${bookingId}/payments`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ method: 'BANK_TRANSFER' })
      .expect(401);

    await request(app.getHttpServer())
      .post(`/api/v1/management/bookings/${bookingId}/payments`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ method: 'BANK_TRANSFER' })
      .expect(403);

    const paymentResponses = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/management/bookings/${bookingId}/payments`)
        .set('Authorization', `Bearer ${requireStaffToken()}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ method: 'BANK_TRANSFER' }),
      request(app.getHttpServer())
        .post(`/api/v1/management/bookings/${bookingId}/payments`)
        .set('Authorization', `Bearer ${requireStaffToken()}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ method: 'BANK_TRANSFER' }),
    ]);

    expect(paymentResponses.map((response) => response.status)).toEqual([
      201, 201,
    ]);

    const firstPaymentBody = paymentResponses[0]
      .body as ApiResponseBody<PaymentBody>;
    const secondPaymentBody = paymentResponses[1]
      .body as ApiResponseBody<PaymentBody>;

    expect(secondPaymentBody.data.id).toBe(firstPaymentBody.data.id);
    expect(firstPaymentBody.data).toMatchObject({
      bookingId,
      amount: createBody.data.totalAmount,
      currency: 'VND',
      method: 'BANK_TRANSFER',
      status: 'SUCCESS',
      createdByUserId: testStaffId,
    });
    expect(await paymentsRepository.countBy({ bookingId })).toBe(1);

    await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({ status: 'CHECKED_IN' })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/management/bookings/${bookingId}/payments`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .set('Idempotency-Key', `second-${uniqueSuffix}`)
      .send({ method: 'CASH' })
      .expect(409);

    const customerPaymentsResponse = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${bookingId}/payments`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .expect(200);
    const customerPaymentsBody =
      customerPaymentsResponse.body as ApiResponseBody<PaymentBody[]>;

    expect(customerPaymentsBody.data).toHaveLength(1);
    expect(customerPaymentsBody.data[0].id).toBe(firstPaymentBody.data.id);

    await request(app.getHttpServer())
      .patch(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .send({ reason: 'Cannot silently cancel a paid booking.' })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/management/payments/${firstPaymentBody.data.id}/refund`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .send({ reason: 'Customer requested a refund.' })
      .expect(403);

    const refundResponse = await request(app.getHttpServer())
      .post(`/api/v1/management/payments/${firstPaymentBody.data.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Customer requested a refund.' })
      .expect(200);
    const refundBody = refundResponse.body as ApiResponseBody<PaymentBody>;

    expect(refundBody.data).toMatchObject({
      status: 'REFUNDED',
      refundedByUserId: testAdminId,
    });
    expect(refundBody.data.refundedAt).toEqual(expect.any(String));
    expect(await roomCalendarRepository.countBy({ bookingId })).toBe(0);

    const refundedBookingResponse = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .expect(200);
    const refundedBookingBody =
      refundedBookingResponse.body as ApiResponseBody<BookingBody>;

    expect(refundedBookingBody.data).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'REFUNDED',
    });

    await request(app.getHttpServer())
      .post(`/api/v1/management/payments/${firstPaymentBody.data.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Repeated refund request.' })
      .expect(200);
  });

  it('processes a signed Return fallback and keeps a later IPN idempotent', async () => {
    const roomId = requireTestRoomId();
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .send({
        roomId,
        checkInDate: '2033-01-10',
        checkOutDate: '2033-01-12',
        guestCount: 2,
      })
      .expect(201);
    const createBody = createResponse.body as ApiResponseBody<BookingBody>;
    const bookingId = createBody.data.id;
    const idempotencyKey = `vnpay-${uniqueSuffix}`;

    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/payments`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ bankCode: 'VNBANK', locale: 'vn' })
      .expect(401);

    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/payments`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ bankCode: 'VNBANK', locale: 'vn' })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/payments`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .send({ bankCode: 'VNBANK', locale: 'vn' })
      .expect(400);

    const onlineResponse = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/payments`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ bankCode: 'VNBANK', locale: 'vn' })
      .expect(201);
    const onlineBody =
      onlineResponse.body as ApiResponseBody<OnlinePaymentBody>;
    const payment = onlineBody.data.payment;
    const paymentUrl = new URL(onlineBody.data.paymentUrl);
    const gatewayReference = payment.gatewayReference;

    expect(payment).toMatchObject({
      bookingId,
      amount: createBody.data.totalAmount,
      currency: 'VND',
      method: 'VNPAY',
      status: 'PENDING',
      gatewayName: 'VNPAY',
      createdByUserId: null,
    });
    expect(gatewayReference).toEqual(expect.any(String));
    expect(paymentUrl.origin + paymentUrl.pathname).toBe(
      'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    );
    expect(paymentUrl.searchParams.get('vnp_Amount')).toBe('270000000');
    expect(paymentUrl.searchParams.get('vnp_TmnCode')).toBe('TEST0001');
    expect(paymentUrl.searchParams.get('vnp_TxnRef')).toBe(gatewayReference);
    expect(paymentUrl.searchParams.get('vnp_SecureHash')).toMatch(
      /^[0-9a-f]{128}$/,
    );

    const replayResponse = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/payments`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ bankCode: 'VNBANK', locale: 'vn' })
      .expect(201);
    const replayBody =
      replayResponse.body as ApiResponseBody<OnlinePaymentBody>;

    expect(replayBody.data.payment.id).toBe(payment.id);
    expect(replayBody.data.paymentUrl).toBe(onlineBody.data.paymentUrl);
    expect(await paymentsRepository.countBy({ bookingId })).toBe(1);

    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/payments`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .set('Idempotency-Key', `vnpay-second-${uniqueSuffix}`)
      .send({ locale: 'en' })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/management/bookings/${bookingId}/payments`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .set('Idempotency-Key', `manual-during-vnpay-${uniqueSuffix}`)
      .send({ method: 'CASH' })
      .expect(409);

    if (gatewayReference === null) {
      throw new Error('VNPay gateway reference was not created.');
    }

    const callbackParameters = {
      vnp_Amount: '270000000',
      vnp_BankCode: 'NCB',
      vnp_OrderInfo: `Thanh toan booking ${createBody.data.bookingCode}`,
      vnp_PayDate: formatVnPayDate(new Date()),
      vnp_ResponseCode: '00',
      vnp_TmnCode: 'TEST0001',
      vnp_TransactionNo: `${Date.now()}`,
      vnp_TransactionStatus: '00',
      vnp_TxnRef: gatewayReference,
    };
    const callbackSignature = createVnPaySignature(
      callbackParameters,
      'test-vnpay-secret-at-least-16-characters',
    );

    const invalidReturnResponse = await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/return')
      .query({
        ...callbackParameters,
        vnp_Amount: '1',
        vnp_SecureHash: callbackSignature,
      })
      .expect(200);

    expect(invalidReturnResponse.body).toMatchObject({
      data: {
        validSignature: false,
        paymentId: null,
        bookingId: null,
        paymentStatus: null,
      },
    });
    expect(
      (await paymentsRepository.findOneByOrFail({ id: payment.id })).status,
    ).toBe('PENDING');

    const invalidSignatureResponse = await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/ipn')
      .query({
        ...callbackParameters,
        vnp_Amount: '1',
        vnp_SecureHash: callbackSignature,
      })
      .expect(200);

    expect(invalidSignatureResponse.body).toEqual({
      RspCode: '97',
      Message: 'Invalid signature',
    });

    const invalidAmountParameters = {
      ...callbackParameters,
      vnp_Amount: '1',
    };
    const invalidAmountResponse = await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/ipn')
      .query({
        ...invalidAmountParameters,
        vnp_SecureHash: createVnPaySignature(
          invalidAmountParameters,
          'test-vnpay-secret-at-least-16-characters',
        ),
      })
      .expect(200);

    expect(invalidAmountResponse.body).toEqual({
      RspCode: '04',
      Message: 'Invalid amount',
    });

    const returnResponse = await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/return')
      .query({
        ...callbackParameters,
        vnp_SecureHash: callbackSignature,
      })
      .expect(200);
    const returnBody = returnResponse.body as ApiResponseBody<{
      validSignature: boolean;
      paymentId: string;
      bookingId: string;
      paymentStatus: string;
    }>;

    expect(returnBody.data).toMatchObject({
      validSignature: true,
      paymentId: payment.id,
      bookingId,
      paymentStatus: 'SUCCESS',
    });

    const ipnResponse = await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/ipn')
      .query({
        ...callbackParameters,
        vnp_SecureHash: callbackSignature,
      })
      .expect(200);

    expect(ipnResponse.body).toEqual({
      RspCode: '02',
      Message: 'Order already confirmed',
    });

    const paidPayment = await paymentsRepository.findOneByOrFail({
      id: payment.id,
    });
    const paidBooking = await bookingsRepository.findOneByOrFail({
      id: bookingId,
    });

    expect(paidPayment).toMatchObject({
      status: 'SUCCESS',
      gatewayResponseCode: '00',
      gatewayTransactionStatus: '00',
      gatewayTransactionId: callbackParameters.vnp_TransactionNo,
    });
    expect(paidBooking).toMatchObject({
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paymentExpiresAt: null,
    });

    const repeatedReturnResponse = await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/return')
      .query({
        ...callbackParameters,
        vnp_SecureHash: callbackSignature,
      })
      .expect(200);

    expect(repeatedReturnResponse.body).toMatchObject({
      data: {
        validSignature: true,
        paymentId: payment.id,
        bookingId,
        paymentStatus: 'SUCCESS',
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/management/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Missing idempotency key.' })
      .expect(400);

    const refundSpy = jest
      .spyOn(vnPayGatewayService, 'refundFull')
      .mockResolvedValue({
        isVerified: true,
        isSuccess: true,
        responseCode: '00',
        transactionStatus: '00',
        transactionId: '987654321012345',
        transactionType: '02',
        amount: payment.amount.replace(/[.]00$/, ''),
        responseId: 'REFUND-SUCCESS',
        message: 'Refund successful',
      });

    try {
      const refundResponse = await request(app.getHttpServer())
        .post(`/api/v1/management/payments/${payment.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `refund-success-${uniqueSuffix}`)
        .send({ reason: 'Customer requested an online refund.' })
        .expect(200);
      const refundBody = refundResponse.body as ApiResponseBody<PaymentBody>;

      expect(refundBody.data).toMatchObject({
        status: 'REFUNDED',
        refundedByUserId: testAdminId,
      });
      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(
        await bookingsRepository.findOneByOrFail({ id: bookingId }),
      ).toMatchObject({
        status: 'CANCELLED',
        paymentStatus: 'REFUNDED',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/management/payments/${payment.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `refund-success-${uniqueSuffix}`)
        .send({ reason: 'Idempotent replay.' })
        .expect(200);

      expect(refundSpy).toHaveBeenCalledTimes(1);
    } finally {
      refundSpy.mockRestore();
    }
  });

  it('keeps an ambiguous VNPay refund pending and reconciles without a duplicate refund', async () => {
    const paid = await createPaidVnPayBooking(
      '2034-02-10',
      '2034-02-12',
      `vnpay-timeout-${uniqueSuffix}`,
    );
    const refundKey = `refund-timeout-${uniqueSuffix}`;
    const refundSpy = jest
      .spyOn(vnPayGatewayService, 'refundFull')
      .mockRejectedValue(new Error('Simulated VNPay timeout'));
    const querySpy = jest
      .spyOn(vnPayGatewayService, 'queryTransaction')
      .mockResolvedValue({
        isVerified: true,
        isSuccess: true,
        responseCode: '00',
        transactionStatus: '00',
        transactionId: paid.transactionId,
        transactionType: '01',
        amount: (
          BigInt(paid.payment.amount.replace(/[.]00$/, '')) * 100n
        ).toString(),
        responseId: 'QUERY-PAYMENT',
        message: 'Original payment is successful',
      });

    try {
      await request(app.getHttpServer())
        .post(`/api/v1/management/payments/${paid.payment.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', refundKey)
        .send({ reason: 'Refund with an ambiguous gateway timeout.' })
        .expect(503);

      expect(
        await paymentsRepository.findOneByOrFail({ id: paid.payment.id }),
      ).toMatchObject({
        status: 'REFUND_PENDING',
        refundIdempotencyKey: refundKey,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/management/payments/${paid.payment.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', refundKey)
        .send({ reason: 'Safe retry of the same request.' })
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({
            message: 'Yeu cau refund da duoc ghi nhan. VNPay van dang xu ly.',
            data: { status: 'REFUND_PENDING' },
          });
        });

      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(
        await paymentsRepository.findOneByOrFail({ id: paid.payment.id }),
      ).toMatchObject({
        status: 'REFUND_PENDING',
        refundGatewayTransactionId: null,
      });

      const blockedTransition = await request(app.getHttpServer())
        .patch(`/api/v1/management/bookings/${paid.bookingId}/status`)
        .set('Authorization', `Bearer ${requireStaffToken()}`)
        .send({ status: 'CHECKED_IN' })
        .expect(409);

      expect(blockedTransition.body).toMatchObject({
        message: 'Booking dang co yeu cau hoan tien VNPay cho doi soat.',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/management/payments/${paid.payment.id}/reconcile-refund`)
        .set('Authorization', `Bearer ${requireCustomerToken()}`)
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/v1/management/payments/${paid.payment.id}/reconcile-refund`)
        .expect(401);

      await paymentsRepository.update(paid.payment.id, {
        refundGatewayTransactionId: '987654321012346',
      });
      querySpy.mockResolvedValueOnce({
        isVerified: true,
        isSuccess: true,
        responseCode: '00',
        transactionStatus: '00',
        transactionId: '987654321012346',
        transactionType: '02',
        amount: (
          BigInt(paid.payment.amount.replace(/[.]00$/, '')) * 100n
        ).toString(),
        responseId: 'QUERY-REFUND',
        message: 'Refund is successful',
      });

      const reconcileResponse = await request(app.getHttpServer())
        .post(`/api/v1/management/payments/${paid.payment.id}/reconcile-refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const reconcileBody =
        reconcileResponse.body as ApiResponseBody<PaymentBody>;

      expect(reconcileBody.message).toBe(
        'Doi soat xac nhan refund VNPay da hoan tat.',
      );
      expect(reconcileBody.data).toMatchObject({
        status: 'REFUNDED',
        refundedByUserId: testAdminId,
      });
      expect(querySpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          transactionId: '987654321012346',
        }),
      );
      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(
        await bookingsRepository.findOneByOrFail({ id: paid.bookingId }),
      ).toMatchObject({
        status: 'CANCELLED',
        paymentStatus: 'REFUNDED',
      });
    } finally {
      refundSpy.mockRestore();
      querySpy.mockRestore();
    }
  });

  it('accepts a verified VNPay refund that is still being processed', async () => {
    const paid = await createPaidVnPayBooking(
      '2034-02-13',
      '2034-02-15',
      `vnpay-refund-pending-${uniqueSuffix}`,
    );
    const refundSpy = jest
      .spyOn(vnPayGatewayService, 'refundFull')
      .mockResolvedValue({
        isVerified: true,
        isSuccess: true,
        responseCode: '00',
        transactionStatus: '05',
        transactionId: '987654321012347',
        transactionType: '02',
        amount: (
          BigInt(paid.payment.amount.replace(/[.]00$/, '')) * 100n
        ).toString(),
        responseId: 'REFUND-PENDING',
        message: 'Request successful',
      });

    try {
      await request(app.getHttpServer())
        .post(`/api/v1/management/payments/${paid.payment.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `refund-pending-${uniqueSuffix}`)
        .send({ reason: 'Customer requested a refund.' })
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({
            message: 'Yeu cau refund da duoc ghi nhan. VNPay van dang xu ly.',
            data: {
              status: 'REFUND_PENDING',
              refundResponseCode: '00',
              refundTransactionStatus: '05',
              refundGatewayTransactionId: '987654321012347',
            },
          });
        });

      expect(
        await bookingsRepository.findOneByOrFail({ id: paid.bookingId }),
      ).toMatchObject({
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
      });
    } finally {
      refundSpy.mockRestore();
    }
  });

  it('restores the previous payment status when VNPay rejects a refund', async () => {
    const paid = await createPaidVnPayBooking(
      '2034-03-10',
      '2034-03-12',
      `vnpay-rejected-${uniqueSuffix}`,
    );
    const refundKey = `refund-rejected-${uniqueSuffix}`;
    const refundSpy = jest
      .spyOn(vnPayGatewayService, 'refundFull')
      .mockResolvedValue({
        isVerified: true,
        isSuccess: false,
        responseCode: '91',
        transactionStatus: '91',
        transactionId: null,
        transactionType: '02',
        amount: null,
        responseId: 'REFUND-REJECTED',
        message: 'Transaction not found',
      });

    try {
      await request(app.getHttpServer())
        .post(`/api/v1/management/payments/${paid.payment.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', refundKey)
        .send({ reason: 'Rejected refund request.' })
        .expect(409);

      expect(
        await paymentsRepository.findOneByOrFail({ id: paid.payment.id }),
      ).toMatchObject({
        status: 'SUCCESS',
        refundIdempotencyKey: refundKey,
        refundResponseCode: '91',
      });
      expect(
        await bookingsRepository.findOneByOrFail({ id: paid.bookingId }),
      ).toMatchObject({
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/management/payments/${paid.payment.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', refundKey)
        .send({ reason: 'Rejected replay.' })
        .expect(409);

      expect(refundSpy).toHaveBeenCalledTimes(1);
    } finally {
      refundSpy.mockRestore();
    }
  });

  it('redirects VNPay Return to the configured frontend result page', async () => {
    const configService = app.get(ConfigService);

    configService.set(
      'VNPAY_FRONTEND_RETURN_URL',
      'http://localhost:5173/payment-result',
    );

    try {
      const response = await request(app.getHttpServer())
        .get('/api/v1/payments/vnpay/return')
        .query({ vnp_SecureHash: 'invalid' })
        .redirects(0)
        .expect(302);
      const location = response.headers.location;

      if (typeof location !== 'string') {
        throw new Error('VNPay frontend redirect location was not returned.');
      }

      const redirectUrl = new URL(location);

      expect(redirectUrl.origin + redirectUrl.pathname).toBe(
        'http://localhost:5173/payment-result',
      );
      expect(Object.fromEntries(redirectUrl.searchParams)).toEqual({
        validSignature: 'false',
      });
    } finally {
      configService.set('VNPAY_FRONTEND_RETURN_URL', '');
    }
  });

  it('uses IPN as the primary VNPay update before the browser Return', async () => {
    const roomId = requireTestRoomId();
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .send({
        roomId,
        checkInDate: '2033-02-10',
        checkOutDate: '2033-02-12',
        guestCount: 2,
      })
      .expect(201);
    const createBody = createResponse.body as ApiResponseBody<BookingBody>;
    const bookingId = createBody.data.id;
    const onlineResponse = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/payments`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .set('Idempotency-Key', `ipn-first-${uniqueSuffix}`)
      .send({ bankCode: 'VNBANK', locale: 'vn' })
      .expect(201);
    const onlineBody =
      onlineResponse.body as ApiResponseBody<OnlinePaymentBody>;
    const payment = onlineBody.data.payment;
    const [wholeAmount, fractionalAmount] = payment.amount.split('.');
    const callbackParameters = {
      vnp_Amount: (
        BigInt(wholeAmount) * 100n +
        BigInt(fractionalAmount)
      ).toString(),
      vnp_OrderInfo: `Thanh toan booking ${createBody.data.bookingCode}`,
      vnp_PayDate: formatVnPayDate(new Date()),
      vnp_ResponseCode: '00',
      vnp_TmnCode: 'TEST0001',
      vnp_TransactionNo: `${Date.now()}`,
      vnp_TransactionStatus: '00',
      vnp_TxnRef: payment.gatewayReference as string,
    };
    const callbackSignature = createVnPaySignature(
      callbackParameters,
      'test-vnpay-secret-at-least-16-characters',
    );

    await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/ipn')
      .query({
        ...callbackParameters,
        vnp_SecureHash: callbackSignature,
      })
      .expect(200)
      .expect({
        RspCode: '00',
        Message: 'Confirm Success',
      });

    expect(
      await paymentsRepository.findOneByOrFail({ id: payment.id }),
    ).toMatchObject({
      status: 'SUCCESS',
      gatewayTransactionId: callbackParameters.vnp_TransactionNo,
    });
    expect(
      await bookingsRepository.findOneByOrFail({ id: bookingId }),
    ).toMatchObject({
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paymentExpiresAt: null,
    });

    await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/return')
      .query({
        ...callbackParameters,
        vnp_SecureHash: callbackSignature,
      })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          data: {
            validSignature: true,
            paymentId: payment.id,
            bookingId,
            paymentStatus: 'SUCCESS',
          },
        });
      });
  });

  it('flags a successful VNPay IPN after booking expiration for review', async () => {
    const roomId = requireTestRoomId();
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .send({
        roomId,
        checkInDate: '2034-01-10',
        checkOutDate: '2034-01-12',
        guestCount: 2,
      })
      .expect(201);
    const createBody = createResponse.body as ApiResponseBody<BookingBody>;
    const bookingId = createBody.data.id;
    const onlineResponse = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/payments`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .set('Idempotency-Key', `late-ipn-${uniqueSuffix}`)
      .send({ locale: 'vn' })
      .expect(201);
    const onlineBody =
      onlineResponse.body as ApiResponseBody<OnlinePaymentBody>;
    const payment = onlineBody.data.payment;

    await bookingsRepository.update(bookingId, {
      paymentExpiresAt: new Date(Date.now() - 1000),
    });
    await paymentsRepository.update(payment.id, {
      expiresAt: new Date(Date.now() - 1000),
    });
    await app.get(BookingService).expirePendingPayments();
    await app.get(PaymentService).expirePendingOnlinePayments();

    expect(
      await bookingsRepository.findOneByOrFail({ id: bookingId }),
    ).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'UNPAID',
    });
    expect(await roomCalendarRepository.countBy({ bookingId })).toBe(0);

    const [wholeAmount, fractionalAmount] = payment.amount.split('.');
    const callbackParameters = {
      vnp_Amount: (
        BigInt(wholeAmount) * 100n +
        BigInt(fractionalAmount)
      ).toString(),
      vnp_PayDate: formatVnPayDate(new Date()),
      vnp_ResponseCode: '00',
      vnp_TmnCode: 'TEST0001',
      vnp_TransactionNo: `${Date.now()}`,
      vnp_TransactionStatus: '00',
      vnp_TxnRef: payment.gatewayReference as string,
    };
    const callbackSignature = createVnPaySignature(
      callbackParameters,
      'test-vnpay-secret-at-least-16-characters',
    );

    const ipnResponse = await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/ipn')
      .query({
        ...callbackParameters,
        vnp_SecureHash: callbackSignature,
      })
      .expect(200);

    expect(ipnResponse.body).toEqual({
      RspCode: '00',
      Message: 'Confirm Success',
    });
    expect(
      await paymentsRepository.findOneByOrFail({ id: payment.id }),
    ).toMatchObject({
      status: 'REQUIRES_REVIEW',
      gatewayTransactionId: callbackParameters.vnp_TransactionNo,
      gatewayResponseCode: '00',
      gatewayTransactionStatus: '00',
    });
    expect(
      await bookingsRepository.findOneByOrFail({ id: bookingId }),
    ).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'UNPAID',
    });
    expect(await roomCalendarRepository.countBy({ bookingId })).toBe(0);

    await request(app.getHttpServer())
      .get('/api/v1/management/payments')
      .query({ status: 'REQUIRES_REVIEW' })
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/management/payments')
      .query({ status: 'REQUIRES_REVIEW' })
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .expect(403);
    const reviewListResponse = await request(app.getHttpServer())
      .get('/api/v1/management/payments')
      .query({ status: 'REQUIRES_REVIEW' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const reviewListBody = reviewListResponse.body as ApiResponseBody<
      PaymentBody[]
    >;

    expect(reviewListBody.data.map((item) => item.id)).toContain(payment.id);

    await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/ipn')
      .query({
        ...callbackParameters,
        vnp_SecureHash: callbackSignature,
      })
      .expect(200)
      .expect({
        RspCode: '02',
        Message: 'Order already confirmed',
      });
  });

  it('expires unpaid bookings and refuses stays in the past', async () => {
    const roomId = requireTestRoomId();

    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .send({
        roomId,
        checkInDate: '2020-01-01',
        checkOutDate: '2020-01-02',
        guestCount: 1,
      })
      .expect(400);

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .send({
        roomId,
        checkInDate: '2032-11-10',
        checkOutDate: '2032-11-12',
        guestCount: 2,
      })
      .expect(201);
    const createBody = createResponse.body as ApiResponseBody<BookingBody>;
    const bookingId = createBody.data.id;
    const onlinePaymentResponse = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/payments`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .set('Idempotency-Key', `expiring-vnpay-${uniqueSuffix}`)
      .send({ locale: 'vn' })
      .expect(201);
    const onlinePaymentBody =
      onlinePaymentResponse.body as ApiResponseBody<OnlinePaymentBody>;

    await bookingsRepository.update(bookingId, {
      paymentExpiresAt: new Date(Date.now() - 1000),
    });
    await paymentsRepository.update(onlinePaymentBody.data.payment.id, {
      expiresAt: new Date(Date.now() - 1000),
    });

    const legacyCreateResponse = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .send({
        roomId,
        checkInDate: '2032-12-10',
        checkOutDate: '2032-12-12',
        guestCount: 2,
      })
      .expect(201);
    const legacyCreateBody =
      legacyCreateResponse.body as ApiResponseBody<BookingBody>;
    const legacyBookingId = legacyCreateBody.data.id;

    await bookingsRepository.update(legacyBookingId, {
      paymentExpiresAt: null,
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    await request(app.getHttpServer())
      .post(`/api/v1/management/bookings/${legacyBookingId}/payments`)
      .set('Authorization', `Bearer ${requireStaffToken()}`)
      .set('Idempotency-Key', `expired-${uniqueSuffix}`)
      .send({ method: 'CASH' })
      .expect(409);

    await app.get(PaymentService).expirePendingOnlinePayments();
    await app.get(BookingService).expirePendingPayments();

    const expiredResponse = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .expect(200);
    const expiredBody = expiredResponse.body as ApiResponseBody<BookingBody>;

    expect(expiredBody.data).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'UNPAID',
      paymentExpiresAt: null,
    });
    expect(await roomCalendarRepository.countBy({ bookingId })).toBe(0);
    expect(
      await paymentsRepository.findOneByOrFail({
        id: onlinePaymentBody.data.payment.id,
      }),
    ).toMatchObject({
      status: 'FAILED',
      gatewayResponseCode: 'EXPIRED',
    });

    const legacyExpiredBooking = await bookingsRepository.findOneByOrFail({
      id: legacyBookingId,
    });

    expect(legacyExpiredBooking.status).toBe('CANCELLED');
    expect(
      await roomCalendarRepository.countBy({ bookingId: legacyBookingId }),
    ).toBe(0);
  });

  it('hard-deletes a room without booking history', async () => {
    const roomTypeId = requireTestRoomTypeId();
    const disposableRoomNumber = `DELETE-${uniqueSuffix}`;
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        roomTypeId,
        roomNumber: disposableRoomNumber,
        name: `Disposable E2E Room ${uniqueSuffix}`,
      })
      .expect(201);
    const createBody = createResponse.body as ApiResponseBody<RoomBody>;
    const roomId = createBody.data.id;

    await dataSource.query(
      'INSERT INTO room_calendar (room_id, stay_date, status, reason) VALUES (?, ?, ?, ?)',
      [roomId, '2031-01-01', 'BLOCKED', 'E2E delete protection'],
    );

    await request(app.getHttpServer())
      .delete(`/api/v1/rooms/${roomId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    await dataSource.query(
      'DELETE FROM room_calendar WHERE room_id = ? AND stay_date = ?',
      [roomId, '2031-01-01'],
    );

    await request(app.getHttpServer())
      .delete(`/api/v1/rooms/${roomId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/rooms/${roomId}`)
      .expect(404);

    expect(await roomsRepository.findOneBy({ id: roomId })).toBeNull();
  });

  afterAll(async () => {
    if (roomCalendarRepository !== undefined && testRoomId !== undefined) {
      await roomCalendarRepository.delete({ roomId: testRoomId });
    }

    if (bookingsRepository !== undefined && testRoomId !== undefined) {
      await dataSource.query(
        `DELETE payment
         FROM payments payment
         INNER JOIN bookings booking ON booking.id = payment.booking_id
         WHERE booking.room_id = ?`,
        [testRoomId],
      );
      await bookingsRepository.delete({ roomId: testRoomId });
    }

    if (roomImagesRepository !== undefined && testRoomId !== undefined) {
      await clearManagedRoomImages(testRoomId);
    }

    if (roomsRepository !== undefined && testRoomId !== undefined) {
      await roomsRepository.delete(testRoomId);
    }

    if (dataSource !== undefined && testRoomNumber !== undefined) {
      await dataSource.query('DELETE FROM rooms WHERE room_number = ?', [
        testRoomNumber,
      ]);
    }

    if (roomTypesRepository !== undefined && testRoomTypeId !== undefined) {
      await roomTypesRepository.delete(testRoomTypeId);
    }

    if (amenitiesRepository !== undefined && testAmenityIds.length > 0) {
      await amenitiesRepository.delete(testAmenityIds);
    }

    if (customersRepository !== undefined && testCustomerId !== undefined) {
      await customersRepository.delete(testCustomerId);
    }

    if (customersRepository !== undefined) {
      for (const customerId of counterCustomerIds) {
        await customersRepository.delete(customerId);
      }
    }

    if (usersRepository !== undefined && testAdminId !== undefined) {
      await usersRepository.delete(testAdminId);
    }

    if (usersRepository !== undefined && testStaffId !== undefined) {
      await usersRepository.delete(testStaffId);
    }

    if (app !== undefined) {
      await app.close();
    }
  });

  async function createPaidVnPayBooking(
    checkInDate: string,
    checkOutDate: string,
    idempotencyKey: string,
  ): Promise<{
    bookingId: string;
    payment: PaymentBody;
    transactionId: string;
  }> {
    const bookingResponse = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .send({
        roomId: requireTestRoomId(),
        checkInDate,
        checkOutDate,
        guestCount: 2,
      })
      .expect(201);
    const booking = bookingResponse.body as ApiResponseBody<BookingBody>;
    const paymentResponse = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${booking.data.id}/payments`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ bankCode: 'VNBANK', locale: 'vn' })
      .expect(201);
    const onlinePayment =
      paymentResponse.body as ApiResponseBody<OnlinePaymentBody>;
    const payment = onlinePayment.data.payment;
    const paymentUrl = new URL(onlinePayment.data.paymentUrl);

    if (payment.gatewayReference === null) {
      throw new Error('VNPay gateway reference was not created.');
    }

    const transactionId = `${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
    const callbackParameters = {
      vnp_Amount: paymentUrl.searchParams.get('vnp_Amount') as string,
      vnp_BankCode: 'NCB',
      vnp_OrderInfo: paymentUrl.searchParams.get('vnp_OrderInfo') as string,
      vnp_PayDate: formatVnPayDate(new Date()),
      vnp_ResponseCode: '00',
      vnp_TmnCode: 'TEST0001',
      vnp_TransactionNo: transactionId,
      vnp_TransactionStatus: '00',
      vnp_TxnRef: payment.gatewayReference,
    };

    await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/ipn')
      .query({
        ...callbackParameters,
        vnp_SecureHash: createVnPaySignature(
          callbackParameters,
          'test-vnpay-secret-at-least-16-characters',
        ),
      })
      .expect(200, {
        RspCode: '00',
        Message: 'Confirm Success',
      });

    const listResponse = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${booking.data.id}/payments`)
      .set('Authorization', `Bearer ${requireCustomerToken()}`)
      .expect(200);
    const listBody = listResponse.body as ApiResponseBody<PaymentBody[]>;

    return {
      bookingId: booking.data.id,
      payment: listBody.data[0],
      transactionId,
    };
  }

  async function clearManagedRoomImages(roomId: string): Promise<void> {
    const images = await roomImagesRepository.findBy({ roomId });
    const storage = app.get(RoomImageStorageService);

    await Promise.all(
      images.map((image) => storage.deleteManaged(image.imageUrl)),
    );
    await roomImagesRepository.delete({ roomId });
  }

  function requireTestRoomTypeId(): string {
    if (testRoomTypeId === undefined) {
      throw new Error('The test RoomType has not been created.');
    }

    return testRoomTypeId;
  }

  function requireTestRoomId(): string {
    if (testRoomId === undefined) {
      throw new Error('The test Room has not been created.');
    }

    return testRoomId;
  }

  function requireStaffToken(): string {
    if (staffToken === undefined) {
      throw new Error('The test Staff token has not been created.');
    }

    return staffToken;
  }

  function requireCustomerToken(): string {
    if (customerToken === undefined) {
      throw new Error('The test Customer token has not been created.');
    }

    return customerToken;
  }

  function getVietnamDate(dayOffset: number): string {
    const vietnamOffsetMilliseconds = 7 * 60 * 60 * 1000;
    const dayMilliseconds = 24 * 60 * 60 * 1000;

    return new Date(
      Date.now() + vietnamOffsetMilliseconds + dayOffset * dayMilliseconds,
    )
      .toISOString()
      .slice(0, 10);
  }
});
