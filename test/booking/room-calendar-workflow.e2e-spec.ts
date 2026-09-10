import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, In, type Repository } from 'typeorm';
import { TypeOrmTransactionalAuditLog } from '../../src/module/audit/persistence/typeorm-transactional-audit-log';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../../src/module/audit/domain/audit-log';
import { AuditLog } from '../../src/module/audit/schema/audit-log.entity';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import migrationDataSource from '../../src/database/data-source';
import { AccessTokenService } from '../../src/module/auth/access-token.service';
import { PasswordHasherService } from '../../src/module/auth/password-hasher.service';
import { Booking } from '../../src/module/booking/schema/booking.entity';
import {
  BookingPaymentStatus,
  BookingStatus,
} from '../../src/module/booking/domain/booking-state';
import { RoomCalendar } from '../../src/module/booking/schema/room-calendar.entity';
import { RoomCalendarStatus } from '../../src/module/booking/domain/room-calendar-status';
import { Customer } from '../../src/module/customer/schema/customer.entity';
import { Room } from '../../src/module/room/schema/room.entity';
import { RoomStatus } from '../../src/module/room/domain/room-status';
import { RoomType } from '../../src/module/room-type/schema/room-type.entity';
import { User } from '../../src/module/user/schema/user.entity';
import { E2eHarness } from '../e2e-harness';

const PASSWORD = 'StrongPassword123!';

interface Envelope<T> {
  data: T;
}

interface CalendarPayload {
  id: string;
  stayDate: string;
  status: RoomCalendarStatus;
  reason: string | null;
  booking: { id: string; bookingCode: string } | null;
}

describe('Room calendar workflow (e2e)', () => {
  let app: INestApplication<App>;
  let harness: E2eHarness | undefined;
  let dataSource: DataSource;
  let rooms: Repository<Room>;
  let roomTypes: Repository<RoomType>;
  let calendars: Repository<RoomCalendar>;
  let bookings: Repository<Booking>;
  let customers: Repository<Customer>;
  let users: Repository<User>;
  let hasher: PasswordHasherService;
  let accessTokens: AccessTokenService;
  let adminToken: string;
  let staffToken: string;
  let customerToken: string;
  const suffix = E2eHarness.createUniqueSuffix();
  const roomIds: string[] = [];
  const roomTypeIds: string[] = [];
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
    calendars = dataSource.getRepository(RoomCalendar);
    bookings = dataSource.getRepository(Booking);
    customers = dataSource.getRepository(Customer);
    users = dataSource.getRepository(User);
    hasher = app.get(PasswordHasherService);
    accessTokens = app.get(AccessTokenService);

    const admin = await createUser('ADMIN');
    const staff = await createUser('STAFF');
    const customer = await createCustomer();
    adminToken = signUser(admin);
    staffToken = signUser(staff);
    customerToken = accessTokens.sign({
      actorType: 'customer',
      customerId: customer.id,
      tokenVersion: customer.tokenVersion,
    });

    harness.registerCleanup(async () => {
      if (roomIds.length > 0) {
        await dataSource
          .getRepository(AuditLog)
          .delete({ entityType: AuditEntityType.ROOM, entityId: In(roomIds) });
        await calendars.delete({ roomId: In(roomIds) });
      }
      if (calendarIds.length > 0)
        await calendars.delete([...new Set(calendarIds)]);
      if (bookingIds.length > 0)
        await bookings.delete([...new Set(bookingIds)]);
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

  it('lists exact nights, keeps the end date exclusive, and validates range limits', async () => {
    const room = await createRoom();
    const range = {
      from: '2038-02-01',
      to: '2038-02-04',
      reason: 'Planned maintenance',
    };

    await request(app.getHttpServer())
      .get(`/api/v1/management/rooms/${room.id}/calendar`)
      .query({ from: range.from, to: range.to })
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200)
      .expect((response) => {
        expect((response.body as Envelope<CalendarPayload[]>).data).toEqual([]);
      });

    const blocked = await request(app.getHttpServer())
      .post(`/api/v1/management/rooms/${room.id}/blocks`)
      .set('Authorization', 'Bearer ' + staffToken)
      .send(range)
      .expect(201);
    const entries = (blocked.body as Envelope<CalendarPayload[]>).data;
    calendarIds.push(...entries.map((entry) => entry.id));
    expect(entries.map((entry) => entry.stayDate)).toEqual([
      '2038-02-01',
      '2038-02-02',
      '2038-02-03',
    ]);

    const listed = await request(app.getHttpServer())
      .get(`/api/v1/management/rooms/${room.id}/calendar`)
      .query({ from: range.from, to: range.to })
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    expect((listed.body as Envelope<CalendarPayload[]>).data).toHaveLength(3);

    await request(app.getHttpServer())
      .post(`/api/v1/management/rooms/${room.id}/blocks`)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ from: '2038-02-02', to: '2038-02-05', reason: 'Overlap' })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/management/rooms/${room.id}/blocks`)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ from: '2038-01-01', to: '2039-02-02', reason: 'Too long' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/management/rooms/${room.id}/blocks`)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ from: '2038-02-04', to: '2038-02-04', reason: 'Empty' })
      .expect(400);

    const pastDate = await request(app.getHttpServer())
      .post(`/api/v1/management/rooms/${room.id}/blocks`)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        from: '2020-01-01',
        to: '2020-01-02',
        reason: 'Past-date characterization',
      })
      .expect(201);
    calendarIds.push(
      ...(pastDate.body as Envelope<CalendarPayload[]>).data.map(
        (entry) => entry.id,
      ),
    );

    const unblocked = await request(app.getHttpServer())
      .delete(`/api/v1/management/rooms/${room.id}/blocks`)
      .query({ from: range.from, to: range.to })
      .set('Authorization', 'Bearer ' + staffToken)
      .expect(200);
    expect(unblocked.body).toMatchObject({ data: { removedCount: 3 } });
  });

  it('preserves RESERVED nights, enforces missing-room and ownership constraints', async () => {
    const room = await createRoom();
    const booking = await createDirectCheckedBooking(
      room.id,
      '2038-03-10',
      '2038-03-12',
    );
    const reserved = await calendars.save(
      calendars.create({
        roomId: room.id,
        bookingId: booking.id,
        stayDate: '2038-03-10',
        status: RoomCalendarStatus.RESERVED,
        reason: null,
      }),
    );
    calendarIds.push(reserved.id);

    await request(app.getHttpServer())
      .post(`/api/v1/management/rooms/${room.id}/blocks`)
      .set('Authorization', 'Bearer ' + staffToken)
      .send({
        from: '2038-03-10',
        to: '2038-03-11',
        reason: 'Must not overwrite reservation',
      })
      .expect(409);
    const unblockReserved = await request(app.getHttpServer())
      .delete(`/api/v1/management/rooms/${room.id}/blocks`)
      .query({ from: '2038-03-10', to: '2038-03-11' })
      .set('Authorization', 'Bearer ' + staffToken)
      .expect(200);
    expect(unblockReserved.body).toMatchObject({ data: { removedCount: 0 } });
    expect(await calendars.findOneByOrFail({ id: reserved.id })).toMatchObject({
      status: RoomCalendarStatus.RESERVED,
      bookingId: booking.id,
    });

    await request(app.getHttpServer())
      .post('/api/v1/management/rooms/999999999/blocks')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ from: '2038-03-01', to: '2038-03-02', reason: 'Missing room' })
      .expect(404);

    await expect(
      dataSource.query(
        "INSERT INTO room_calendar (room_id, booking_id, stay_date, status, reason) VALUES (?, NULL, ?, 'RESERVED', NULL)",
        [room.id, '2038-03-20'],
      ),
    ).rejects.toThrow();
  });

  it('serializes concurrent blocks and block-vs-booking through the Room lock', async () => {
    const concurrentRoom = await createRoom();
    const blockResponses = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/management/rooms/${concurrentRoom.id}/blocks`)
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ from: '2038-04-01', to: '2038-04-03', reason: 'Concurrent A' }),
      request(app.getHttpServer())
        .post(`/api/v1/management/rooms/${concurrentRoom.id}/blocks`)
        .set('Authorization', 'Bearer ' + staffToken)
        .send({ from: '2038-04-01', to: '2038-04-03', reason: 'Concurrent B' }),
    ]);
    expect(blockResponses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const concurrentEntries = await calendars.findBy({
      roomId: concurrentRoom.id,
    });
    calendarIds.push(...concurrentEntries.map((entry) => entry.id));
    expect(concurrentEntries).toHaveLength(2);

    const bookingRoom = await createRoom();
    const competing = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', 'Bearer ' + customerToken)
        .send({
          roomId: bookingRoom.id,
          checkInDate: '2027-08-10',
          checkOutDate: '2027-08-12',
          guestCount: 1,
        }),
      request(app.getHttpServer())
        .post(`/api/v1/management/rooms/${bookingRoom.id}/blocks`)
        .set('Authorization', 'Bearer ' + staffToken)
        .send({ from: '2027-08-10', to: '2027-08-12', reason: 'Booking race' }),
    ]);
    expect(competing.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const bookingResponse = competing.find(
      (response) => response.status === 201,
    );
    const bookingBody = bookingResponse?.body as
      { data?: { id?: unknown } } | undefined;
    if (typeof bookingBody?.data?.id === 'string') {
      bookingIds.push(bookingBody.data.id);
      const reservedEntries = await calendars.findBy({
        roomId: bookingRoom.id,
      });
      calendarIds.push(...reservedEntries.map((entry) => entry.id));
    } else {
      const blockedEntries = await calendars.findBy({ roomId: bookingRoom.id });
      calendarIds.push(...blockedEntries.map((entry) => entry.id));
    }
  });

  it('audits block/unblock with the caller and rolls back calendar and audit together', async () => {
    const room = await createRoom();
    const range = { from: '2030-02-01', to: '2030-02-03' };
    const logs = dataSource.getRepository(AuditLog);
    const where = { entityType: AuditEntityType.ROOM, entityId: room.id };
    const audit = app.get(TypeOrmTransactionalAuditLog);
    const original = audit.record.bind(audit);
    const block = () =>
      request(app.getHttpServer())
        .post(`/api/v1/management/rooms/${room.id}/blocks`)
        .set('Authorization', 'Bearer ' + staffToken)
        .send({ ...range, reason: ' Maintenance ' });
    const unblock = () =>
      request(app.getHttpServer())
        .delete(`/api/v1/management/rooms/${room.id}/blocks`)
        .set('Authorization', 'Bearer ' + adminToken)
        .query(range);
    const failAudit = () =>
      jest.spyOn(audit, 'record').mockImplementation(async (context, input) => {
        await original(context, input);
        throw new Error('fixture calendar audit failure after insert');
      });
    let spy = failAudit();
    try {
      await block().expect(500);
      expect(await calendars.countBy({ roomId: room.id })).toBe(0);
      expect(await logs.countBy(where)).toBe(0);
    } finally {
      spy.mockRestore();
    }
    const blocked = await block().expect(201);
    const blockLog = await logs.findOneByOrFail({
      ...where,
      action: AuditAction.ROOM_CALENDAR_BLOCKED,
    });
    expect(blockLog).toMatchObject({
      actorType: AuditActorType.USER,
      actorId: userIds[1],
      requestId: (blocked.body as { requestId: string }).requestId,
    });
    expect(blockLog.metadata).toEqual({
      schemaVersion: 1,
      ...range,
      reason: 'Maintenance',
      addedCount: 2,
    });
    await block().expect(409);
    expect(await logs.countBy(where)).toBe(1);
    spy = failAudit();
    try {
      await unblock().expect(500);
      expect(await calendars.countBy({ roomId: room.id })).toBe(2);
      expect(await logs.countBy(where)).toBe(1);
    } finally {
      spy.mockRestore();
    }
    const unblocked = await unblock().expect(200);
    expect(
      (unblocked.body as Envelope<{ removedCount: number }>).data.removedCount,
    ).toBe(2);
    const unblockLog = await logs.findOneByOrFail({
      ...where,
      action: AuditAction.ROOM_CALENDAR_UNBLOCKED,
    });
    expect(unblockLog).toMatchObject({
      actorType: AuditActorType.USER,
      actorId: userIds[0],
      requestId: (unblocked.body as { requestId: string }).requestId,
    });
    expect(unblockLog.metadata).toEqual({
      schemaVersion: 1,
      ...range,
      removedCount: 2,
    });
    await unblock().expect(200);
    expect(await logs.countBy(where)).toBe(2);
    expect(await calendars.countBy({ roomId: room.id })).toBe(0);
  });

  async function createRoom(): Promise<Room> {
    const roomType = await roomTypes.save(
      roomTypes.create({
        name: 'Calendar ' + suffix + '-' + sequence,
        description: null,
        maxGuests: 2,
        basePrice: '100.00',
        amenities: [],
      }),
    );
    roomTypeIds.push(roomType.id);
    sequence += 1;
    const room = await rooms.save(
      rooms.create({
        roomTypeId: roomType.id,
        roomNumber: 'RC-' + suffix + '-' + sequence,
        name: 'Calendar room ' + sequence,
        description: null,
        status: RoomStatus.READY,
      }),
    );
    roomIds.push(room.id);
    return room;
  }

  async function createDirectCheckedBooking(
    roomId: string,
    from: string,
    to: string,
  ): Promise<Booking> {
    const customer = await customers.findOneByOrFail({ id: customerIds[0] });
    const booking = await bookings.save(
      bookings.create({
        bookingCode:
          'CAL-' +
          suffix.replace(/[^A-Za-z0-9]/g, '').slice(-28) +
          '-' +
          sequence,
        customerId: customer.id,
        roomId,
        createdByUserId: null,
        checkInDate: from,
        checkOutDate: to,
        guestCount: 1,
        contactName: customer.fullName,
        contactPhone: customer.phone,
        contactEmail: customer.email,
        totalAmount: '100.00',
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.PAID,
        paymentExpiresAt: null,
        customerNote: null,
        cancelledAt: null,
        cancellationReason: null,
      }),
    );
    bookingIds.push(booking.id);
    return booking;
  }

  async function createUser(role: 'ADMIN' | 'STAFF'): Promise<User> {
    const user = await users.save(
      users.create({
        fullName: 'Calendar ' + role,
        email: 'calendar-' + role.toLowerCase() + '-' + suffix + '@example.com',
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

  async function createCustomer(): Promise<Customer> {
    const customer = await customers.save(
      customers.create({
        fullName: 'Calendar customer',
        email: 'calendar-customer-' + suffix + '@example.com',
        phone: '09' + String(Date.now()).slice(-8),
        passwordHash: null,
        tokenVersion: 0,
        status: 'ACTIVE',
      }),
    );
    customerIds.push(customer.id);
    return customer;
  }

  function signUser(user: User): string {
    return accessTokens.sign({
      actorType: 'user',
      userId: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
  }
});
