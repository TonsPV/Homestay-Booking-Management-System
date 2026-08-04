import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import sharp from 'sharp';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/http';
import migrationDataSource from '../src/database/data-source';
import { AccessTokenService } from '../src/module/auth/access-token.service';
import { PasswordHasherService } from '../src/module/auth/password-hasher.service';
import {
  Booking,
  BookingPaymentStatus,
  BookingStatus,
} from '../src/module/booking/schema/booking.entity';
import {
  RoomCalendar,
  RoomCalendarStatus,
} from '../src/module/booking/schema/room-calendar.entity';
import { Customer } from '../src/module/customer/schema/customer.entity';
import { RoomImage } from '../src/module/room/schema/room-image.entity';
import { Room, RoomStatus } from '../src/module/room/schema/room.entity';
import { RoomType } from '../src/module/room-type/schema/room-type.entity';
import { User } from '../src/module/user/schema/user.entity';
import { E2eHarness } from './e2e-harness';

const PASSWORD = 'StrongPassword123!';

interface Envelope<T> {
  data: T;
}

interface RoomPayload {
  id: string;
  roomTypeId: string;
  roomNumber: string;
  name: string;
  status: RoomStatus;
  images: Array<{ id: string; imageUrl: string; isCover: boolean }>;
}

interface ImagePayload {
  id: string;
  imageUrl: string;
  isCover: boolean;
}

describe('Room mutation/state workflow (e2e)', () => {
  let app: INestApplication<App>;
  let harness: E2eHarness | undefined;
  let dataSource: DataSource;
  let rooms: Repository<Room>;
  let roomTypes: Repository<RoomType>;
  let images: Repository<RoomImage>;
  let calendars: Repository<RoomCalendar>;
  let bookings: Repository<Booking>;
  let customers: Repository<Customer>;
  let users: Repository<User>;
  let hasher: PasswordHasherService;
  let tokens: AccessTokenService;
  let adminToken: string;
  let staffToken: string;
  const suffix = E2eHarness.createUniqueSuffix();
  const roomIds: string[] = [];
  const roomTypeIds: string[] = [];
  const imageIds: string[] = [];
  const calendarIds: string[] = [];
  const bookingIds: string[] = [];
  const customerIds: string[] = [];
  const userIds: string[] = [];
  let sequence = 0;

  beforeAll(async () => {
    harness = new E2eHarness(migrationDataSource);
    await harness.initialize();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    rooms = dataSource.getRepository(Room);
    roomTypes = dataSource.getRepository(RoomType);
    images = dataSource.getRepository(RoomImage);
    calendars = dataSource.getRepository(RoomCalendar);
    bookings = dataSource.getRepository(Booking);
    customers = dataSource.getRepository(Customer);
    users = dataSource.getRepository(User);
    hasher = app.get(PasswordHasherService);
    tokens = app.get(AccessTokenService);

    const admin = await createUser('ADMIN');
    const staff = await createUser('STAFF');
    adminToken = signUser(admin);
    staffToken = signUser(staff);

    harness.registerCleanup(async () => {
      if (bookingIds.length > 0)
        await bookings.delete([...new Set(bookingIds)]);
      if (calendarIds.length > 0)
        await calendars.delete([...new Set(calendarIds)]);
      if (imageIds.length > 0) await images.delete([...new Set(imageIds)]);
      if (roomIds.length > 0) await rooms.delete([...new Set(roomIds)]);
      if (roomTypeIds.length > 0)
        await roomTypes.delete([...new Set(roomTypeIds)]);
      if (customerIds.length > 0)
        await customers.delete([...new Set(customerIds)]);
      if (userIds.length > 0) await users.delete([...new Set(userIds)]);
    });
  });

  afterAll(async () => {
    try {
      await harness?.cleanup();
    } finally {
      await app?.close();
    }
  });

  it('enforces ADMIN mutation boundaries, unique deleted numbers, and history-protected delete', async () => {
    const roomType = await createRoomType('Mutation CRUD ' + suffix);
    const room = await createRoom(roomType, RoomStatus.READY);

    await request(app.getHttpServer())
      .post('/api/v1/rooms')
      .set('Authorization', 'Bearer ' + staffToken)
      .send({
        roomTypeId: roomType.id,
        roomNumber: nextNumber(),
        name: 'Staff denied',
      })
      .expect(403);

    const update = await request(app.getHttpServer())
      .patch('/api/v1/rooms/' + room.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ name: '  Updated mutation room  ' })
      .expect(200);
    expect((update.body as Envelope<RoomPayload>).data.name).toBe(
      'Updated mutation room',
    );

    await request(app.getHttpServer())
      .patch('/api/v1/rooms/' + room.id)
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ name: 'Staff denied' })
      .expect(403);

    const deleted = await rooms.softDelete(room.id);
    expect(deleted.affected).toBe(1);
    await request(app.getHttpServer())
      .post('/api/v1/rooms')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        roomTypeId: roomType.id,
        roomNumber: room.roomNumber,
        name: 'Deleted duplicate',
      })
      .expect(409);

    const protectedRoom = await createRoom(roomType, RoomStatus.READY);
    const calendar = await calendars.save(
      calendars.create({
        roomId: protectedRoom.id,
        bookingId: null,
        stayDate: '2038-01-02',
        status: RoomCalendarStatus.BLOCKED,
        reason: 'mutation history guard',
      }),
    );
    calendarIds.push(calendar.id);
    await request(app.getHttpServer())
      .delete('/api/v1/rooms/' + protectedRoom.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(409);
  });

  it('keeps the ADMIN/STAFF status matrix explicit for every status pair', async () => {
    const roomType = await createRoomType('Mutation status ' + suffix);
    const room = await createRoom(roomType, RoomStatus.READY);
    const statuses = Object.values(RoomStatus);

    for (const current of statuses) {
      for (const next of statuses) {
        await rooms.update(room.id, { status: current });
        const adminResponse = await request(app.getHttpServer())
          .patch('/api/v1/rooms/' + room.id + '/status')
          .set('Authorization', 'Bearer ' + adminToken)
          .send({ status: next });
        expect(adminResponse.status).toBe(200);

        await rooms.update(room.id, { status: current });
        const staffResponse = await request(app.getHttpServer())
          .patch('/api/v1/rooms/' + room.id + '/status')
          .set('Authorization', 'Bearer ' + staffToken)
          .send({ status: next });
        const staffMayChange =
          current !== RoomStatus.HIDDEN && next !== RoomStatus.HIDDEN;
        expect(staffResponse.status).toBe(staffMayChange ? 200 : 403);
      }
    }
  });

  it('reproduces the CHECKED_IN room-state invariant gap in the Room status API', async () => {
    const roomType = await createRoomType('Mutation occupancy ' + suffix);
    const room = await createRoom(roomType, RoomStatus.OCCUPIED);
    const customer = await customers.save(
      customers.create({
        fullName: 'Mutation invariant customer',
        email: 'mutation-invariant-' + suffix + '@example.com',
        phone: '09' + String(Date.now()).slice(-8),
        passwordHash: null,
        tokenVersion: 0,
        status: 'ACTIVE',
      }),
    );
    customerIds.push(customer.id);
    const booking = await bookings.save(
      bookings.create({
        bookingCode: 'INV-' + suffix.replace(/[^A-Za-z0-9]/g, '').slice(-28),
        customerId: customer.id,
        roomId: room.id,
        createdByUserId: null,
        checkInDate: '2038-01-01',
        checkOutDate: '2038-01-03',
        guestCount: 1,
        contactName: customer.fullName,
        contactPhone: customer.phone,
        contactEmail: customer.email,
        totalAmount: '100.00',
        status: BookingStatus.CHECKED_IN,
        paymentStatus: BookingPaymentStatus.PAID,
        paymentExpiresAt: null,
        customerNote: null,
        cancelledAt: null,
        cancellationReason: null,
      }),
    );
    bookingIds.push(booking.id);

    const response = await request(app.getHttpServer())
      .patch('/api/v1/rooms/' + room.id + '/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: RoomStatus.READY });
    expect(response.status).toBe(200);
    const finalRoom = await rooms.findOneByOrFail({ id: room.id });
    const finalBooking = await bookings.findOneByOrFail({ id: booking.id });
    expect(finalBooking.status).toBe(BookingStatus.CHECKED_IN);
    expect(finalRoom.status).toBe(RoomStatus.READY);
  });

  it('does not let a stale general update overwrite a concurrent ADMIN HIDDEN transition', async () => {
    const roomType = await createRoomType('Mutation stale ' + suffix);
    const room = await createRoom(roomType, RoomStatus.READY);
    const originalFindOneBy = rooms.findOneBy.bind(rooms);
    let observedRead!: () => void;
    const readObserved = new Promise<void>(
      (resolve) => (observedRead = resolve),
    );
    let releaseRead!: () => void;
    const readRelease = new Promise<void>((resolve) => (releaseRead = resolve));
    const spy = jest
      .spyOn(rooms, 'findOneBy')
      .mockImplementationOnce(async (where) => {
        const result = await originalFindOneBy(where);
        observedRead();
        await readRelease;
        return result;
      });

    const pendingUpdate = request(app.getHttpServer())
      .patch('/api/v1/rooms/' + room.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ name: 'Stale-safe update' })
      .then((response) => response);
    await readObserved;
    await request(app.getHttpServer())
      .patch('/api/v1/rooms/' + room.id + '/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: RoomStatus.HIDDEN })
      .expect(200);
    releaseRead();
    try {
      await expect(pendingUpdate).resolves.toMatchObject({ status: 200 });
    } finally {
      releaseRead();
      spy.mockRestore();
    }
    expect((await rooms.findOneByOrFail({ id: room.id })).status).toBe(
      RoomStatus.HIDDEN,
    );
  });

  it('hard-deletes a history-free room and cleans managed image storage', async () => {
    const roomType = await createRoomType('Mutation storage ' + suffix);
    const room = await createRoom(roomType, RoomStatus.READY);
    const image = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();
    const upload = await request(app.getHttpServer())
      .post('/api/v1/rooms/' + room.id + '/images')
      .set('Authorization', 'Bearer ' + adminToken)
      .attach('file', image, {
        filename: 'mutation.png',
        contentType: 'image/png',
      })
      .expect(201);
    const payload = (upload.body as Envelope<ImagePayload>).data;
    const imageUrl = payload.imageUrl;
    expect(imageUrl).toEqual(expect.stringContaining('/media/room-images/'));
    const deleted = await request(app.getHttpServer())
      .delete('/api/v1/rooms/' + room.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    expect((deleted.body as Envelope<RoomPayload>).data.id).toBe(room.id);
    await request(app.getHttpServer()).get(imageUrl).expect(404);
  });

  async function createRoomType(name: string): Promise<RoomType> {
    const roomType = await roomTypes.save(
      roomTypes.create({
        name,
        description: null,
        maxGuests: 2,
        basePrice: '100.00',
        amenities: [],
      }),
    );
    roomTypeIds.push(roomType.id);
    return roomType;
  }

  async function createRoom(
    roomType: RoomType,
    status: RoomStatus,
  ): Promise<Room> {
    const room = await rooms.save(
      rooms.create({
        roomTypeId: roomType.id,
        roomNumber: nextNumber(),
        name: 'Mutation room ' + sequence,
        description: null,
        status,
      }),
    );
    roomIds.push(room.id);
    return room;
  }

  async function createUser(role: 'ADMIN' | 'STAFF'): Promise<User> {
    const user = await users.save(
      users.create({
        fullName: 'Room mutation ' + role,
        email:
          'room-mutation-' + role.toLowerCase() + '-' + suffix + '@example.com',
        phone: null,
        passwordHash: await hasher.hash(PASSWORD),
        tokenVersion: 0,
        role,
        status: 'ACTIVE',
      }),
    );
    userIds.push(user.id);
    return user;
  }

  function signUser(user: User): string {
    return tokens.sign({
      actorType: 'user',
      userId: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
  }

  function nextNumber(): string {
    sequence += 1;
    return 'RM-' + suffix + '-' + sequence;
  }
});
