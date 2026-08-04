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
import { RoomStatus, Room } from '../src/module/room/schema/room.entity';
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

interface RoomTypePayload {
  id: string;
  name: string;
  description: string | null;
  maxGuests: number;
  basePrice: string;
  amenities: Array<{ id: string; name: string }>;
  deletedAt?: string | null;
}

describe('RoomType workflow (e2e)', () => {
  let app: INestApplication<App>;
  let e2eHarness: E2eHarness | undefined;
  let dataSource: DataSource;
  let roomTypesRepository: Repository<RoomType>;
  let amenitiesRepository: Repository<Amenity>;
  let roomsRepository: Repository<Room>;
  let usersRepository: Repository<User>;
  let passwordHasher: PasswordHasherService;
  let accessTokenService: AccessTokenService;
  let admin: User;
  let adminToken: string;
  const createdRoomTypeIds: string[] = [];
  const createdAmenityIds: string[] = [];
  const createdRoomIds: string[] = [];
  const createdUserIds: string[] = [];
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
    roomTypesRepository = dataSource.getRepository(RoomType);
    amenitiesRepository = dataSource.getRepository(Amenity);
    roomsRepository = dataSource.getRepository(Room);
    usersRepository = dataSource.getRepository(User);
    passwordHasher = app.get(PasswordHasherService);
    accessTokenService = app.get(AccessTokenService);
    admin = await createAdmin();
    adminToken = tokenForUser(admin);

    e2eHarness.registerCleanup(async () => {
      if (createdRoomIds.length > 0) {
        await roomsRepository.delete([...new Set(createdRoomIds)]);
      }
      if (createdRoomTypeIds.length > 0) {
        await roomTypesRepository.delete([...new Set(createdRoomTypeIds)]);
      }
      if (createdAmenityIds.length > 0) {
        await amenitiesRepository.delete([...new Set(createdAmenityIds)]);
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

  it('serves public/admin projections and validates RoomType fields', async () => {
    const name = nextName('base');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/room-types')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        name: '  ' + name + '  ',
        description: null,
        maxGuests: 4,
        basePrice: '125.50',
      })
      .expect(201);
    const body = createResponse.body as ResponseEnvelope<RoomTypePayload>;
    createdRoomTypeIds.push(body.data.id);
    expect(body.data).toMatchObject({
      name,
      description: null,
      maxGuests: 4,
      basePrice: '125.50',
      deletedAt: null,
      amenities: [],
    });

    const publicResponse = await request(app.getHttpServer())
      .get('/api/v1/room-types/' + body.data.id)
      .expect(200);
    const publicBody = publicResponse.body as ResponseEnvelope<RoomTypePayload>;
    expect(publicBody.data).not.toHaveProperty('deletedAt');
    const adminDetail = await request(app.getHttpServer())
      .get('/api/v1/admin/room-types/' + body.data.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    expect(
      (adminDetail.body as ResponseEnvelope<RoomTypePayload>).data.deletedAt,
    ).toBeNull();

    await request(app.getHttpServer())
      .patch('/api/v1/admin/room-types/' + body.data.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/room-types/' + body.data.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ maxGuests: 101 })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/room-types/' + body.data.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ maxGuests: 0 })
      .expect(400);
  });

  it('sets exact active Amenity IDs, sorts the result, and rejects invalid sets', async () => {
    const first = await createAmenity('Zulu ' + uniqueSuffix);
    const second = await createAmenity('Alpha ' + uniqueSuffix);
    const roomType = await createRoomType(nextName('amenities'));

    const setResponse = await request(app.getHttpServer())
      .put('/api/v1/admin/room-types/' + roomType.id + '/amenities')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ amenityIds: [first.id, second.id] })
      .expect(200);
    const setBody = setResponse.body as ResponseEnvelope<RoomTypePayload>;
    expect(setBody.data.amenities.map((amenity) => amenity.name)).toEqual([
      'Alpha ' + uniqueSuffix,
      'Zulu ' + uniqueSuffix,
    ]);

    await request(app.getHttpServer())
      .put('/api/v1/admin/room-types/' + roomType.id + '/amenities')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ amenityIds: [first.id, first.id] })
      .expect(400);
    await request(app.getHttpServer())
      .put('/api/v1/admin/room-types/' + roomType.id + '/amenities')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ amenityIds: ['999999999'] })
      .expect(400);
    await request(app.getHttpServer())
      .put('/api/v1/admin/room-types/' + roomType.id + '/amenities')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ amenityIds: [] })
      .expect(200);
  });

  it('soft-deletes/restores names and blocks deletion while an active Room exists', async () => {
    const roomType = await createRoomType(nextName('room-protection'));
    const room = await roomsRepository.save(
      roomsRepository.create({
        roomTypeId: roomType.id,
        roomNumber: 'RT-' + uniqueSuffix,
        name: 'RoomType protection room',
        description: null,
        status: RoomStatus.READY,
      }),
    );
    createdRoomIds.push(room.id);

    await request(app.getHttpServer())
      .delete('/api/v1/admin/room-types/' + roomType.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(409);
    await roomsRepository.softDelete(room.id);
    await request(app.getHttpServer())
      .delete('/api/v1/admin/room-types/' + roomType.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/room-types/' + roomType.id)
      .expect(404);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/room-types/' + roomType.id + '/restore')
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/room-types/' + roomType.id + '/restore')
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(400);
  });

  async function createAdmin(): Promise<User> {
    const user = await usersRepository.save(
      usersRepository.create({
        fullName: 'RoomType E2E Admin',
        email: nextEmail('admin'),
        phone: null,
        passwordHash: await passwordHasher.hash(PASSWORD),
        tokenVersion: 0,
        role: 'ADMIN',
        status: 'ACTIVE',
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  async function createAmenity(name: string): Promise<Amenity> {
    const amenity = await amenitiesRepository.save(
      amenitiesRepository.create({ name, description: null }),
    );
    createdAmenityIds.push(amenity.id);
    return amenity;
  }

  async function createRoomType(name: string): Promise<RoomType> {
    const roomType = await roomTypesRepository.save(
      roomTypesRepository.create({
        name,
        description: null,
        maxGuests: 2,
        basePrice: '100.00',
        amenities: [],
      }),
    );
    createdRoomTypeIds.push(roomType.id);
    return roomType;
  }

  function tokenForUser(user: User): string {
    return accessTokenService.sign({
      actorType: 'user',
      userId: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
  }

  function nextName(label: string): string {
    fixtureSequence += 1;
    return 'RoomType ' + label + ' ' + uniqueSuffix + ' ' + fixtureSequence;
  }

  function nextEmail(label: string): string {
    fixtureSequence += 1;
    return (
      'room-type-' +
      label +
      '-' +
      uniqueSuffix +
      '-' +
      fixtureSequence +
      '@example.com'
    );
  }
});
