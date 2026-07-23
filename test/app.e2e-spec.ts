import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/http';
import { assertSafeE2eEnvironment } from '../src/config/e2e-environment';
import migrationDataSource from '../src/database/data-source';
import { AccessTokenService } from '../src/module/auth/access-token.service';
import { PasswordHasherService } from '../src/module/auth/password-hasher.service';
import { Customer } from '../src/module/customer/schema/customer.entity';
import { RoomType } from '../src/module/room-type/schema/room-type.entity';
import { RoomImage } from '../src/module/room/schema/room-image.entity';
import { Room } from '../src/module/room/schema/room.entity';
import { User } from '../src/module/user/schema/user.entity';

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

describe('Application API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let customersRepository: Repository<Customer>;
  let usersRepository: Repository<User>;
  let roomTypesRepository: Repository<RoomType>;
  let roomsRepository: Repository<Room>;
  let roomImagesRepository: Repository<RoomImage>;
  let adminToken: string;
  let customerToken: string | undefined;
  let staffToken: string | undefined;
  let testAdminId: string | undefined;
  let testCustomerId: string | undefined;
  let testStaffId: string | undefined;
  let testRoomTypeId: string | undefined;
  let testRoomId: string | undefined;
  let testRoomNumber: string | undefined;
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const roomTypeName = `E2E Room Type ${uniqueSuffix}`;

  beforeAll(async () => {
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
    roomTypesRepository = dataSource.getRepository(RoomType);
    roomsRepository = dataSource.getRepository(Room);
    roomImagesRepository = dataSource.getRepository(RoomImage);

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

  it('manages room images and always keeps a cover when images remain', async () => {
    const roomId = requireTestRoomId();
    const firstResponse = await request(app.getHttpServer())
      .post(`/api/v1/rooms/${roomId}/images`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        imageUrl: 'https://example.com/e2e-room-1.jpg',
        sortOrder: 2,
        isCover: false,
      })
      .expect(201);
    const firstBody = firstResponse.body as ApiResponseBody<RoomImageBody>;

    expect(firstBody.data.isCover).toBe(true);

    const secondResponse = await request(app.getHttpServer())
      .post(`/api/v1/rooms/${roomId}/images`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        imageUrl: 'https://example.com/e2e-room-2.jpg',
        sortOrder: 1,
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

    const remainingImage = await roomImagesRepository.findOneBy({
      id: firstBody.data.id,
    });
    expect(remainingImage?.isCover).toBe(true);
  });

  it('serializes concurrent creation of the first room images', async () => {
    const roomId = requireTestRoomId();

    await roomImagesRepository.delete({ roomId });

    const [firstResponse, secondResponse] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/rooms/${roomId}/images`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          imageUrl: 'https://example.com/e2e-concurrent-room-1.jpg',
        })
        .expect(201),
      request(app.getHttpServer())
        .post(`/api/v1/rooms/${roomId}/images`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          imageUrl: 'https://example.com/e2e-concurrent-room-2.jpg',
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

  it('hard-deletes a room without booking history', async () => {
    const roomId = requireTestRoomId();

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
    testRoomId = undefined;
    testRoomNumber = undefined;
  });

  afterAll(async () => {
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

    if (customersRepository !== undefined && testCustomerId !== undefined) {
      await customersRepository.delete(testCustomerId);
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
});
