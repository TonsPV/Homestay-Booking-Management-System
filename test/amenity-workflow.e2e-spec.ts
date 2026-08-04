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
import { Amenity } from '../src/module/amenity/schema/amenity.entity';
import { Customer } from '../src/module/customer/schema/customer.entity';
import { RoomType } from '../src/module/room-type/schema/room-type.entity';
import { User } from '../src/module/user/schema/user.entity';
import { E2eHarness } from './e2e-harness';

const PASSWORD = 'StrongPassword123!';

interface ResponseEnvelope<TData> {
  success: boolean;
  statusCode: number;
  message: string | string[];
  data: TData;
  meta?: { pagination: Record<string, number> };
}

interface AmenityPayload {
  id: string;
  name: string;
  description: string | null;
  deletedAt?: string | null;
}

describe('Amenity workflow (e2e)', () => {
  let app: INestApplication<App>;
  let e2eHarness: E2eHarness | undefined;
  let dataSource: DataSource;
  let amenitiesRepository: Repository<Amenity>;
  let roomTypesRepository: Repository<RoomType>;
  let usersRepository: Repository<User>;
  let customersRepository: Repository<Customer>;
  let passwordHasher: PasswordHasherService;
  let accessTokenService: AccessTokenService;
  let admin: User;
  let adminToken: string;
  let staffToken: string;
  let customerToken: string;
  const createdAmenityIds: string[] = [];
  const createdRoomTypeIds: string[] = [];
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

    dataSource = app.get(DataSource);
    amenitiesRepository = dataSource.getRepository(Amenity);
    roomTypesRepository = dataSource.getRepository(RoomType);
    usersRepository = dataSource.getRepository(User);
    customersRepository = dataSource.getRepository(Customer);
    passwordHasher = app.get(PasswordHasherService);
    accessTokenService = app.get(AccessTokenService);
    admin = await createUser('ADMIN');
    const staff = await createUser('STAFF');
    const customer = await createCustomer();
    adminToken = tokenForUser(admin);
    staffToken = tokenForUser(staff);
    customerToken = tokenForCustomer(customer);

    e2eHarness.registerCleanup(async () => {
      if (createdRoomTypeIds.length > 0) {
        await roomTypesRepository.delete([...new Set(createdRoomTypeIds)]);
      }
      if (createdAmenityIds.length > 0) {
        await amenitiesRepository.delete([...new Set(createdAmenityIds)]);
      }
      if (createdCustomerIds.length > 0) {
        await customersRepository.delete([...new Set(createdCustomerIds)]);
      }
      if (createdUserIds.length > 0) {
        await usersRepository.delete([...new Set(createdUserIds)]);
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

  it('keeps public/admin projections and authorization boundaries correct', async () => {
    await request(app.getHttpServer()).get('/api/v1/amenities').expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/admin/amenities')
      .set('Authorization', 'Bearer ' + customerToken)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/admin/amenities')
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ name: nextName('staff-rejected') })
      .expect(403);

    const name = nextName('wifi');
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/amenities')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ name: '  ' + name + '  ', description: '  Internet  ' })
      .expect(201);
    const body = response.body as ResponseEnvelope<AmenityPayload>;
    expect(body.data).toMatchObject({
      name,
      description: 'Internet',
      deletedAt: null,
    });
    createdAmenityIds.push(body.data.id);

    const publicResponse = await request(app.getHttpServer())
      .get('/api/v1/amenities/' + body.data.id)
      .expect(200);
    const publicBody = publicResponse.body as ResponseEnvelope<AmenityPayload>;
    expect(publicBody.data).toMatchObject({
      id: body.data.id,
      name,
      description: 'Internet',
    });
    expect(publicBody.data).not.toHaveProperty('deletedAt');

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/admin/amenities')
      .query({ search: name, page: 1, limit: 1 })
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    const listBody = listResponse.body as ResponseEnvelope<AmenityPayload[]>;
    expect(listBody.data).toEqual([
      expect.objectContaining({ id: body.data.id, name }),
    ]);
    expect(listBody.meta?.pagination).toMatchObject({
      total: 1,
      totalPages: 1,
    });

    await request(app.getHttpServer())
      .post('/api/v1/admin/amenities')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ name: name.toUpperCase() })
      .expect(409);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/amenities/' + body.data.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({})
      .expect(400);
  });

  it('soft-deletes, hides, restores, and protects assigned amenities', async () => {
    const deletable = await createAmenity(nextName('deletable'));
    await request(app.getHttpServer())
      .delete('/api/v1/admin/amenities/' + deletable.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/amenities/' + deletable.id)
      .expect(404);
    const adminDeletedResponse = await request(app.getHttpServer())
      .get('/api/v1/admin/amenities/' + deletable.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    expect(
      (adminDeletedResponse.body as ResponseEnvelope<AmenityPayload>).data
        .deletedAt,
    ).toEqual(expect.any(String));
    await request(app.getHttpServer())
      .get('/api/v1/admin/amenities')
      .query({ includeDeleted: true, search: deletable.name })
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/admin/amenities')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ name: deletable.name })
      .expect(409);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/amenities/' + deletable.id + '/restore')
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/amenities/' + deletable.id + '/restore')
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(400);

    const assigned = await createAmenity(nextName('assigned'));
    const roomType = await roomTypesRepository.save(
      roomTypesRepository.create({
        name: nextName('room-type'),
        description: null,
        maxGuests: 2,
        basePrice: '100.00',
        amenities: [assigned],
      }),
    );
    createdRoomTypeIds.push(roomType.id);
    await request(app.getHttpServer())
      .delete('/api/v1/admin/amenities/' + assigned.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(409);
    await dataSource.query(
      'DELETE FROM room_type_amenities WHERE room_type_id = ? AND amenity_id = ?',
      [roomType.id, assigned.id],
    );
    await request(app.getHttpServer())
      .delete('/api/v1/admin/amenities/' + assigned.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
  });

  it('normalizes duplicate-key races and preserves admin update behavior', async () => {
    const raceName = nextName('race');
    const responses = await Promise.all([
      createAmenityRequest(raceName),
      createAmenityRequest(raceName),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const rows = await amenitiesRepository.findBy({ name: raceName });
    expect(rows).toHaveLength(1);
    createdAmenityIds.push(rows[0].id);

    const updatedName = nextName('updated');
    const updateResponse = await request(app.getHttpServer())
      .patch('/api/v1/admin/amenities/' + rows[0].id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ name: ' ' + updatedName + ' ', description: null })
      .expect(200);
    expect(
      (updateResponse.body as ResponseEnvelope<AmenityPayload>).data,
    ).toMatchObject({ name: updatedName, description: null });
  });

  async function createAmenity(name: string): Promise<Amenity> {
    const response = await createAmenityRequest(name);
    if (response.status !== 201) {
      throw new Error(
        'Amenity create failed: ' + JSON.stringify(response.body),
      );
    }
    const id = (response.body as ResponseEnvelope<AmenityPayload>).data.id;
    createdAmenityIds.push(id);
    return amenitiesRepository.findOneByOrFail({ id });
  }

  async function createAmenityRequest(name: string): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/api/v1/admin/amenities')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ name, description: null });
  }

  async function createUser(role: 'ADMIN' | 'STAFF'): Promise<User> {
    const user = await usersRepository.save(
      usersRepository.create({
        fullName: 'Amenity E2E ' + role,
        email: nextEmail('user-' + role),
        phone: null,
        passwordHash: await passwordHasher.hash(PASSWORD),
        tokenVersion: 0,
        role,
        status: 'ACTIVE',
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  async function createCustomer(): Promise<Customer> {
    const customer = await customersRepository.save(
      customersRepository.create({
        fullName: 'Amenity E2E Customer',
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

  function nextName(label: string): string {
    fixtureSequence += 1;
    return 'Amenity ' + label + ' ' + uniqueSuffix + ' ' + fixtureSequence;
  }

  function nextEmail(label: string): string {
    fixtureSequence += 1;
    return (
      'amenity-' +
      label +
      '-' +
      uniqueSuffix +
      '-' +
      fixtureSequence +
      '@example.com'
    );
  }

  function nextLocalPhone(): string {
    fixtureSequence += 1;
    const phoneSuffix = String(
      (Date.now() + fixtureSequence) % 100_000_000,
    ).padStart(8, '0');
    return '09' + phoneSuffix;
  }
});
