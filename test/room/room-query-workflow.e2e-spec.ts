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
import { Booking } from '../../src/module/booking/schema/booking.entity';
import {
  BookingPaymentStatus,
  BookingStatus,
} from '../../src/module/booking/domain/booking-state';
import { RoomCalendar } from '../../src/module/booking/schema/room-calendar.entity';
import { RoomCalendarStatus } from '../../src/module/booking/domain/room-calendar-status';
import { Customer } from '../../src/module/customer/schema/customer.entity';
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
  let roomRepo: Repository<Room>;
  let roomTypeRepo: Repository<RoomType>;
  let amenityRepo: Repository<Amenity>;
  let bookingRepo: Repository<Booking>;
  let calendarRepo: Repository<RoomCalendar>;
  let customerRepo: Repository<Customer>;
  let userRepo: Repository<User>;
  let passwordHasher: PasswordHasherService;
  let accessTokenService: AccessTokenService;
  let adminToken: string;
  const createdRoomIds: string[] = [];
  const createdRoomTypeIds: string[] = [];
  const createdAmenityIds: string[] = [];
  const createdBookingIds: string[] = [];
  const createdCalendarIds: string[] = [];
  const createdCustomerIds: string[] = [];
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
    roomRepo = dataSource.getRepository(Room);
    roomTypeRepo = dataSource.getRepository(RoomType);
    amenityRepo = dataSource.getRepository(Amenity);
    bookingRepo = dataSource.getRepository(Booking);
    calendarRepo = dataSource.getRepository(RoomCalendar);
    customerRepo = dataSource.getRepository(Customer);
    userRepo = dataSource.getRepository(User);
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
        await calendarRepo.delete([...new Set(createdCalendarIds)]);
      }
      if (createdBookingIds.length > 0) {
        await bookingRepo.delete([...new Set(createdBookingIds)]);
      }
      if (createdRoomIds.length > 0) {
        await roomRepo.delete([...new Set(createdRoomIds)]);
      }
      if (createdRoomTypeIds.length > 0) {
        await roomTypeRepo.delete([...new Set(createdRoomTypeIds)]);
      }
      if (createdAmenityIds.length > 0) {
        await amenityRepo.delete([...new Set(createdAmenityIds)]);
      }
      if (createdCustomerIds.length > 0) {
        await customerRepo.delete([...new Set(createdCustomerIds)]);
      }
      if (createdUserIds.length > 0) {
        await userRepo.delete([...new Set(createdUserIds)]);
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
    const calendar = await calendarRepo.save(
      calendarRepo.create({
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

  it('sorts price descending and popularity by their intended primary keys', async () => {
    const customer = await createCustomer();
    const lowPriceType = await createRoomType(
      'Sort low ' + uniqueSuffix,
      99,
      '100.00',
    );
    const tiePriceType = await createRoomType(
      'Sort tie ' + uniqueSuffix,
      99,
      '110.00',
    );
    const middlePriceType = await createRoomType(
      'Sort middle ' + uniqueSuffix,
      99,
      '150.00',
    );
    const highPriceType = await createRoomType(
      'Sort high ' + uniqueSuffix,
      99,
      '200.00',
    );
    const sortRoomName = 'Sort fixture ' + uniqueSuffix;
    const lowPriceRoom = await createRoom(lowPriceType, 'READY', sortRoomName);
    const tiePriceRoom = await createRoom(tiePriceType, 'READY', sortRoomName);
    const middlePriceRoom = await createRoom(
      middlePriceType,
      'READY',
      sortRoomName,
    );
    const highPriceRoom = await createRoom(
      highPriceType,
      'READY',
      sortRoomName,
    );

    await createPopularityBooking(highPriceRoom, customer, 1);
    await createPopularityBooking(highPriceRoom, customer, 2);
    await createPopularityBooking(middlePriceRoom, customer, 3);
    await createPopularityBooking(
      middlePriceRoom,
      customer,
      4,
      BookingStatus.CANCELLED,
    );

    const priceResponse = await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({
        checkIn: '2035-04-01',
        checkOut: '2035-04-03',
        guests: 99,
        sort: 'PRICE_DESC',
        page: 1,
        limit: 2,
      })
      .expect(200);
    const priceBody = priceResponse.body as ResponseEnvelope<
      PublicRoomPayload[]
    >;
    const pricePageTwoResponse = await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({
        checkIn: '2035-04-01',
        checkOut: '2035-04-03',
        guests: 99,
        sort: 'PRICE_DESC',
        page: 2,
        limit: 2,
      })
      .expect(200);
    const pricePageTwoBody = pricePageTwoResponse.body as ResponseEnvelope<
      PublicRoomPayload[]
    >;
    expect(priceBody.meta?.pagination.total).toBe(4);
    expect(priceBody.data.map((room) => room.id)).toEqual([
      highPriceRoom.id,
      middlePriceRoom.id,
    ]);
    expect(pricePageTwoBody.data.map((room) => room.id)).toEqual([
      tiePriceRoom.id,
      lowPriceRoom.id,
    ]);

    const popularityResponse = await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({
        checkIn: '2035-04-01',
        checkOut: '2035-04-03',
        guests: 99,
        sort: 'POPULARITY',
        page: 1,
        limit: 2,
      })
      .expect(200);
    const popularityBody = popularityResponse.body as ResponseEnvelope<
      PublicRoomPayload[]
    >;
    const popularityPageTwoResponse = await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({
        checkIn: '2035-04-01',
        checkOut: '2035-04-03',
        guests: 99,
        sort: 'POPULARITY',
        page: 2,
        limit: 2,
      })
      .expect(200);
    const popularityPageTwoBody =
      popularityPageTwoResponse.body as ResponseEnvelope<PublicRoomPayload[]>;
    expect(popularityBody.meta?.pagination.total).toBe(4);
    expect(popularityBody.data.map((room) => room.id)).toEqual([
      highPriceRoom.id,
      middlePriceRoom.id,
    ]);
    expect(popularityPageTwoBody.data.map((room) => room.id)).toEqual([
      lowPriceRoom.id,
      tiePriceRoom.id,
    ]);
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
    const roomType = await roomTypeRepo.findOneByOrFail({
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
    const admin = await userRepo.save(
      userRepo.create({
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
    const amenity = await amenityRepo.save(
      amenityRepo.create({ name, description: null }),
    );
    createdAmenityIds.push(amenity.id);
    return amenity;
  }

  async function createCustomer(): Promise<Customer> {
    const customer = await customerRepo.save(
      customerRepo.create({
        fullName: 'Room query popularity customer',
        email: nextEmail('popularity-customer'),
        phone: '09' + String(Date.now()).slice(-8),
        passwordHash: null,
        tokenVersion: 0,
        status: 'ACTIVE',
      }),
    );
    createdCustomerIds.push(customer.id);
    return customer;
  }

  async function createRoomType(
    name: string,
    maxGuests: number,
    basePrice: string,
    amenities: Amenity[] = [],
  ): Promise<RoomType> {
    const roomType = await roomTypeRepo.save(
      roomTypeRepo.create({
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
    name = 'Room Query ' + status + ' ' + fixtureSequence,
  ): Promise<Room> {
    const room = await roomRepo.save(
      roomRepo.create({
        roomTypeId: roomType.id,
        roomNumber: 'RQ-' + uniqueSuffix + '-' + nextSequence(),
        name,
        description: null,
        status: status as Room['status'],
      }),
    );
    createdRoomIds.push(room.id);
    return room;
  }

  async function createPopularityBooking(
    room: Room,
    customer: Customer,
    index: number,
    status: BookingStatus = BookingStatus.CONFIRMED,
  ): Promise<Booking> {
    const booking = await bookingRepo.save(
      bookingRepo.create({
        bookingCode: 'RQ-' + uniqueSuffix + '-pop-' + index,
        customerId: customer.id,
        roomId: room.id,
        createdByUserId: null,
        checkInDate: '2035-04-01',
        checkOutDate: '2035-04-03',
        guestCount: 1,
        contactName: customer.fullName,
        contactPhone: customer.phone,
        contactEmail: customer.email,
        totalAmount: '100.00',
        status,
        paymentStatus:
          status === BookingStatus.CANCELLED
            ? BookingPaymentStatus.UNPAID
            : BookingPaymentStatus.PAID,
        acceptedPaymentId: null,
        requestIntentActorType: null,
        requestIntentActorId: null,
        requestIntentKey: null,
        requestIntentHash: null,
        paymentExpiresAt: null,
        customerNote: null,
        cancelledAt:
          status === BookingStatus.CANCELLED
            ? new Date('2035-03-01T00:00:00.000Z')
            : null,
        cancellationReason:
          status === BookingStatus.CANCELLED ? 'Cancelled fixture.' : null,
      }),
    );
    createdBookingIds.push(booking.id);
    return booking;
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
