import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import migrationDataSource from '../../src/database/data-source';
import { AccessTokenService } from '../../src/module/auth/access-token.service';
import { PasswordHasherService } from '../../src/module/auth/password-hasher.service';
import { Amenity } from '../../src/module/amenity/schema/amenity.entity';
import { RoomCalendar } from '../../src/module/booking/schema/room-calendar.entity';
import { RoomCalendarStatus } from '../../src/module/booking/domain/room-calendar-status';
import { Room } from '../../src/module/room/schema/room.entity';
import { BedType } from '../../src/module/room-type/bed-configuration';
import { RoomType } from '../../src/module/room-type/schema/room-type.entity';
import { User } from '../../src/module/user/schema/user.entity';
import { E2eHarness } from '../e2e-harness';

const PASSWORD = 'StrongPassword123!';

interface ResponseEnvelope<TData> {
  success: boolean;
  statusCode: number;
  data: TData;
  meta?: { pagination: Record<string, number> };
}

interface PublicRoomPayload {
  id: string;
  roomTypeId: string;
  name: string;
  roomNumber?: string;
  status?: string;
  roomType?: {
    beds: Array<{ type: BedType; quantity: number }>;
    amenities: Array<{ id: string; name: string }>;
  };
}

describe('Room catalog/query workflow (e2e)', () => {
  let app: INestApplication<App>;
  let e2eHarness: E2eHarness | undefined;
  let roomsRepository: Repository<Room>;
  let roomTypesRepository: Repository<RoomType>;
  let amenitiesRepository: Repository<Amenity>;
  let calendarRepository: Repository<RoomCalendar>;
  let usersRepository: Repository<User>;
  let passwordHasher: PasswordHasherService;
  let accessTokenService: AccessTokenService;
  let adminToken: string;
  const createdRoomIds: string[] = [];
  const createdRoomTypeIds: string[] = [];
  const createdAmenityIds: string[] = [];
  const createdCalendarIds: string[] = [];
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

    const dataSource = app.get(DataSource);
    roomsRepository = dataSource.getRepository(Room);
    roomTypesRepository = dataSource.getRepository(RoomType);
    amenitiesRepository = dataSource.getRepository(Amenity);
    calendarRepository = dataSource.getRepository(RoomCalendar);
    usersRepository = dataSource.getRepository(User);
    passwordHasher = app.get(PasswordHasherService);
    accessTokenService = app.get(AccessTokenService);
    const admin = await createAdmin();
    adminToken = accessTokenService.sign({
      actorType: 'user',
      userId: admin.id,
      role: admin.role,
      tokenVersion: admin.tokenVersion,
    });

    e2eHarness.registerCleanup(async () => {
      if (createdCalendarIds.length > 0) {
        await calendarRepository.delete([...new Set(createdCalendarIds)]);
      }
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

  it('separates public catalog visibility from management inventory', async () => {
    const roomType = await createRoomType(
      'Catalog ' + uniqueSuffix,
      2,
      '100.00',
    );
    const ready = await createRoom(roomType, 'READY');
    const occupied = await createRoom(roomType, 'OCCUPIED');
    const hidden = await createRoom(roomType, 'HIDDEN');
    const maintenance = await createRoom(roomType, 'MAINTENANCE');

    const publicResponse = await request(app.getHttpServer())
      .get('/api/v1/rooms')
      .query({ search: ready.name })
      .expect(200);
    const publicBody = publicResponse.body as ResponseEnvelope<
      PublicRoomPayload[]
    >;
    expect(publicBody.data.map((room) => room.id)).toContain(ready.id);
    expect(publicBody.data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: hidden.id }),
        expect.objectContaining({ id: maintenance.id }),
      ]),
    );
    expect(publicBody.data[0]).not.toHaveProperty('roomNumber');
    expect(publicBody.data[0]).not.toHaveProperty('status');

    const managementResponse = await request(app.getHttpServer())
      .get('/api/v1/management/rooms')
      .query({ limit: 100 })
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    const managementBody = managementResponse.body as ResponseEnvelope<
      PublicRoomPayload[]
    >;
    const managementIds = managementBody.data.map((room) => room.id);
    expect(managementIds).toEqual(
      expect.arrayContaining([
        ready.id,
        occupied.id,
        hidden.id,
        maintenance.id,
      ]),
    );
    const managementRoom = managementBody.data.find(
      (room) => room.id === ready.id,
    );
    expect(managementRoom?.roomNumber).toEqual(expect.any(String));
    expect(managementRoom?.status).toBe('READY');
  });

  it('searches by dates, guests, price, RoomType, and all selected Amenities', async () => {
    const firstAmenity = await createAmenity('Search A ' + uniqueSuffix);
    const secondAmenity = await createAmenity('Search B ' + uniqueSuffix);
    const roomType = await createRoomType(
      'Search ' + uniqueSuffix,
      3,
      '250.00',
      [firstAmenity, secondAmenity],
    );
    const available = await createRoom(roomType, 'READY');
    const blocked = await createRoom(roomType, 'READY');
    const calendar = await calendarRepository.save(
      calendarRepository.create({
        roomId: blocked.id,
        bookingId: null,
        stayDate: '2035-01-02',
        status: RoomCalendarStatus.BLOCKED,
        reason: 'Query E2E block',
      }),
    );
    createdCalendarIds.push(calendar.id);

    const searchResponse = await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({
        checkIn: '2035-01-01',
        checkOut: '2035-01-03',
        guests: 2,
        roomTypeId: roomType.id,
        amenityIds: [firstAmenity.id, secondAmenity.id],
        minPrice: '200.00',
        maxPrice: '300.00',
      })
      .expect(200);
    const searchBody = searchResponse.body as ResponseEnvelope<
      PublicRoomPayload[]
    >;
    const searchIds = searchBody.data.map((room) => room.id);
    expect(searchIds).toContain(available.id);
    expect(searchIds).not.toContain(blocked.id);

    await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({ checkIn: '2035-01-03', checkOut: '2035-01-01', guests: 2 })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/management/rooms/available')
      .query({ checkIn: '2035-01-01', checkOut: '2035-01-03', guests: 4 })
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
  });

  it('returns normalized beds alongside amenities in public room queries', async () => {
    const roomTypeResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/room-types')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        name: 'Beds query ' + uniqueSuffix,
        maxGuests: 3,
        basePrice: '150.00',
        beds: [
          { type: BedType.DOUBLE, quantity: 1 },
          { type: BedType.SINGLE, quantity: 1 },
        ],
      })
      .expect(201);
    const roomTypeId = (roomTypeResponse.body as { data: { id: string } }).data
      .id;
    createdRoomTypeIds.push(roomTypeId);
    const roomType = await roomTypesRepository.findOneByOrFail({
      id: roomTypeId,
    });
    const room = await createRoom(roomType, 'READY');

    const response = await request(app.getHttpServer())
      .get('/api/v1/rooms/' + room.id)
      .expect(200);
    const body = response.body as ResponseEnvelope<PublicRoomPayload>;

    expect(body.data.roomType?.beds).toEqual([
      { type: BedType.SINGLE, quantity: 1 },
      { type: BedType.DOUBLE, quantity: 1 },
    ]);
    expect(body.data.roomType?.amenities).toEqual([]);
  });

  it('validates room query IDs, date ranges, and pagination boundaries', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/rooms')
      .query({ roomTypeId: 'bad-id' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({ checkIn: '2035-02-30', checkOut: '2035-03-01', guests: 2 })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/rooms')
      .query({ page: 0 })
      .expect(400);
  });

  async function createAdmin(): Promise<User> {
    const admin = await usersRepository.save(
      usersRepository.create({
        fullName: 'Room Query E2E Admin',
        email: nextEmail('admin'),
        phone: null,
        passwordHash: await passwordHasher.hash(PASSWORD),
        tokenVersion: 0,
        role: 'ADMIN',
        status: 'ACTIVE',
      }),
    );
    createdUserIds.push(admin.id);
    return admin;
  }

  async function createAmenity(name: string): Promise<Amenity> {
    const amenity = await amenitiesRepository.save(
      amenitiesRepository.create({ name, description: null }),
    );
    createdAmenityIds.push(amenity.id);
    return amenity;
  }

  async function createRoomType(
    name: string,
    maxGuests: number,
    basePrice: string,
    amenities: Amenity[] = [],
  ): Promise<RoomType> {
    const roomType = await roomTypesRepository.save(
      roomTypesRepository.create({
        name,
        description: null,
        maxGuests,
        basePrice,
        amenities,
      }),
    );
    createdRoomTypeIds.push(roomType.id);
    return roomType;
  }

  async function createRoom(
    roomType: RoomType,
    status: RoomStatus,
  ): Promise<Room> {
    const room = await roomsRepository.save(
      roomsRepository.create({
        roomTypeId: roomType.id,
        roomNumber: 'RQ-' + uniqueSuffix + '-' + nextSequence(),
        name: 'Room Query ' + status + ' ' + fixtureSequence,
        description: null,
        status: status as Room['status'],
      }),
    );
    createdRoomIds.push(room.id);
    return room;
  }

  function nextSequence(): number {
    fixtureSequence += 1;
    return fixtureSequence;
  }

  function nextEmail(label: string): string {
    return (
      'room-query-' +
      label +
      '-' +
      uniqueSuffix +
      '-' +
      nextSequence() +
      '@example.com'
    );
  }
});
