import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import { ErrorCode } from '../../src/common/error-codes';
import migrationDataSource from '../../src/database/data-source';
import { AccessTokenService } from '../../src/module/auth/access-token.service';
import { PasswordHasherService } from '../../src/module/auth/password-hasher.service';
import {
  BookingPaymentStatus,
  BookingStatus,
} from '../../src/module/booking/domain/booking-state';
import { RoomCalendar } from '../../src/module/booking/schema/room-calendar.entity';
import { Booking } from '../../src/module/booking/schema/booking.entity';
import { BookingCustomerStore } from '../../src/module/booking/ports/booking-creation.store';
import { AuditLog } from '../../src/module/audit/schema/audit-log.entity';
import { Customer } from '../../src/module/customer/schema/customer.entity';
import { Room } from '../../src/module/room/schema/room.entity';
import { RoomStatus } from '../../src/module/room/domain/room-status';
import { RoomType } from '../../src/module/room-type/schema/room-type.entity';
import { User } from '../../src/module/user/schema/user.entity';
import { E2eHarness } from '../e2e-harness';

const PASSWORD = 'StrongPassword123!';

interface Envelope<T> {
  data: T;
  meta?: { pagination: Record<string, number> };
}

interface BookingPayload {
  id: string;
  bookingCode: string;
  customerId: string;
  roomId: string;
  createdByUserId: string | null;
  checkInDate: string;
  checkOutDate: string;
  guestCount: number;
  totalAmount: string;
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  paymentExpiresAt: string | null;
  customer: { id: string; fullName: string; phone: string };
  room: {
    id: string;
    roomNumber: string;
    name: string;
    roomType: { id: string; name: string };
  };
}

interface ManagementRoomPayload {
  id: string;
  status: RoomStatus;
  calendarSummary: {
    asOfDate: string;
    todayStatus: 'AVAILABLE' | 'RESERVED' | 'BLOCKED';
    nextEvent: {
      stayDate: string;
      status: 'RESERVED' | 'BLOCKED';
      booking: {
        id: string;
        bookingCode: string;
        checkInDate: string;
        checkOutDate: string;
      } | null;
    } | null;
  };
}

describe('Booking create/query workflow (e2e)', () => {
  let app: INestApplication<App>;
  let harness: E2eHarness | undefined;
  let dataSource: DataSource;
  let rooms: Repository<Room>;
  let roomTypes: Repository<RoomType>;
  let calendars: Repository<RoomCalendar>;
  let customers: Repository<Customer>;
  let users: Repository<User>;
  let hasher: PasswordHasherService;
  let accessTokens: AccessTokenService;
  let staffToken: string;
  let customerAToken: string;
  let customerBToken: string;
  let customerA: Customer;
  let customerB: Customer;
  const suffix = E2eHarness.createUniqueSuffix();
  const roomIds: string[] = [];
  const roomTypeIds: string[] = [];
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
    customers = dataSource.getRepository(Customer);
    users = dataSource.getRepository(User);
    hasher = app.get(PasswordHasherService);
    accessTokens = app.get(AccessTokenService);

    const staff = await createUser('STAFF');
    customerA = await createCustomer('A');
    customerB = await createCustomer('B');
    staffToken = signUser(staff);
    customerAToken = signCustomer(customerA);
    customerBToken = signCustomer(customerB);

    harness.registerCleanup(async () => {
      const ownedBookingIds = [...new Set(bookingIds)];
      const ownedRoomIds = [...new Set(roomIds)];
      const ownedCustomerIds = [...new Set(customerIds)];
      if (ownedBookingIds.length > 0) {
        await dataSource.query(
          `DELETE FROM room_calendar WHERE booking_id IN (${placeholders(ownedBookingIds)})`,
          ownedBookingIds,
        );
      }
      if (ownedRoomIds.length > 0) {
        await dataSource.query(
          `DELETE FROM room_calendar WHERE room_id IN (${placeholders(ownedRoomIds)})`,
          ownedRoomIds,
        );
      }
      if (ownedCustomerIds.length > 0) {
        await dataSource.query(
          `DELETE room_calendar FROM room_calendar INNER JOIN bookings ON bookings.id = room_calendar.booking_id WHERE bookings.customer_id IN (${placeholders(ownedCustomerIds)})`,
          ownedCustomerIds,
        );
      }
      const bookingWhere: string[] = [];
      const bookingParameters: string[] = [];
      if (ownedBookingIds.length > 0) {
        bookingWhere.push(`id IN (${placeholders(ownedBookingIds)})`);
        bookingParameters.push(...ownedBookingIds);
      }
      if (ownedCustomerIds.length > 0) {
        bookingWhere.push(`customer_id IN (${placeholders(ownedCustomerIds)})`);
        bookingParameters.push(...ownedCustomerIds);
      }
      if (ownedRoomIds.length > 0) {
        bookingWhere.push(`room_id IN (${placeholders(ownedRoomIds)})`);
        bookingParameters.push(...ownedRoomIds);
      }
      if (bookingWhere.length > 0) {
        await dataSource.query(
          `DELETE FROM bookings WHERE ${bookingWhere.join(' OR ')}`,
          bookingParameters,
        );
      }
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

  it('creates an online booking, snapshots price/calendar, and enforces ownership in query routes', async () => {
    const room = await createRoom('Online');
    const response = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer ' + customerAToken)
      .send({
        roomId: room.id,
        checkInDate: '2027-01-10',
        checkOutDate: '2027-01-12',
        guestCount: 2,
        contactName: '  Booking Customer  ',
        contactPhone: '0901234567',
      })
      .expect(201);
    const booking = (response.body as Envelope<BookingPayload>).data;
    bookingIds.push(booking.id);
    expect(booking).toMatchObject({
      customerId: customerA.id,
      roomId: room.id,
      createdByUserId: null,
      checkInDate: '2027-01-10',
      checkOutDate: '2027-01-12',
      guestCount: 2,
      totalAmount: '250.00',
      status: BookingStatus.PENDING_PAYMENT,
      paymentStatus: BookingPaymentStatus.UNPAID,
    });
    expect(booking.paymentExpiresAt).toEqual(expect.any(String));
    expect(await calendars.countBy({ bookingId: booking.id })).toBe(2);

    const roomInventory = await request(app.getHttpServer())
      .get('/api/v1/management/rooms')
      .query({ search: room.roomNumber })
      .set('Authorization', 'Bearer ' + staffToken)
      .expect(200);
    const inventoryRoom = (
      roomInventory.body as Envelope<ManagementRoomPayload[]>
    ).data.find((item) => item.id === room.id);
    expect(inventoryRoom).toMatchObject({
      id: room.id,
      status: RoomStatus.READY,
      calendarSummary: {
        nextEvent: {
          status: 'RESERVED',
          booking: {
            id: booking.id,
            bookingCode: booking.bookingCode,
            checkInDate: booking.checkInDate,
            checkOutDate: booking.checkOutDate,
          },
        },
      },
    });

    const availability = await request(app.getHttpServer())
      .get('/api/v1/management/rooms/available')
      .query({
        checkIn: booking.checkInDate,
        checkOut: booking.checkOutDate,
        guests: booking.guestCount,
        limit: 100,
      })
      .set('Authorization', 'Bearer ' + staffToken)
      .expect(200);
    expect(
      (availability.body as Envelope<ManagementRoomPayload[]>).data.map(
        (item) => item.id,
      ),
    ).not.toContain(room.id);

    const publicAvailability = await request(app.getHttpServer())
      .get('/api/v1/rooms/search')
      .query({
        checkIn: booking.checkInDate,
        checkOut: booking.checkOutDate,
        guests: booking.guestCount,
        limit: 100,
      })
      .expect(200);
    expect(
      (publicAvailability.body as Envelope<Array<{ id: string }>>).data.map(
        (item) => item.id,
      ),
    ).not.toContain(room.id);

    await roomTypes.update(room.roomTypeId, { basePrice: '200.00' });
    const historicalBooking = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${booking.id}`)
      .set('Authorization', 'Bearer ' + customerAToken)
      .expect(200);
    expect(
      (historicalBooking.body as Envelope<BookingPayload>).data.totalAmount,
    ).toBe('250.00');

    const bookingAtNewPrice = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer ' + customerAToken)
      .send({
        roomId: room.id,
        checkInDate: '2027-01-13',
        checkOutDate: '2027-01-15',
        guestCount: 1,
      })
      .expect(201);
    const newPriceBooking = (bookingAtNewPrice.body as Envelope<BookingPayload>)
      .data;
    bookingIds.push(newPriceBooking.id);
    expect(newPriceBooking.totalAmount).toBe('400.00');

    const customerList = await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .set('Authorization', 'Bearer ' + customerAToken)
      .query({ status: BookingStatus.PENDING_PAYMENT })
      .expect(200);
    expect(
      (customerList.body as Envelope<BookingPayload[]>).data.map(
        (item) => item.id,
      ),
    ).toContain(booking.id);

    await request(app.getHttpServer())
      .get(`/api/v1/bookings/${booking.id}`)
      .set('Authorization', 'Bearer ' + customerBToken)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/bookings/${booking.id}`)
      .set('Authorization', 'Bearer ' + customerAToken)
      .expect(200);

    const management = await request(app.getHttpServer())
      .get(`/api/v1/management/bookings/${booking.id}`)
      .set('Authorization', 'Bearer ' + staffToken)
      .expect(200);
    expect((management.body as Envelope<BookingPayload>).data.id).toBe(
      booking.id,
    );
    expect(
      (management.body as Envelope<BookingPayload>).data.createdByUserId,
    ).toBeNull();
  });

  it('enforces date/capacity boundaries and the active unpaid quota', async () => {
    const room = await createRoom('Quota');
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer ' + customerAToken)
      .send({
        roomId: room.id,
        checkInDate: '2027-02-01',
        checkOutDate: '2027-02-02',
        guestCount: 3,
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer ' + customerAToken)
      .send({
        roomId: room.id,
        checkInDate: '2027-02-02',
        checkOutDate: '2027-02-01',
        guestCount: 1,
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer ' + customerAToken)
      .send({
        roomId: room.id,
        checkInDate: '2027-02-03',
        checkOutDate: '2027-05-05',
        guestCount: 1,
      })
      .expect(400);

    const created: string[] = [];
    for (const [from, to] of [
      ['2027-02-10', '2027-02-11'],
      ['2027-02-12', '2027-02-13'],
      ['2027-02-14', '2027-02-15'],
    ]) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', 'Bearer ' + customerBToken)
        .send({
          roomId: room.id,
          checkInDate: from,
          checkOutDate: to,
          guestCount: 1,
        })
        .expect(201);
      const booking = (response.body as Envelope<BookingPayload>).data;
      created.push(booking.id);
      bookingIds.push(booking.id);
    }
    expect(created).toHaveLength(3);
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer ' + customerBToken)
      .send({
        roomId: room.id,
        checkInDate: '2027-02-16',
        checkOutDate: '2027-02-17',
        guestCount: 1,
      })
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/api/v1/bookings/${created[0]}/cancel`)
      .set('Authorization', 'Bearer ' + customerBToken)
      .send({ reason: 'Quota release' })
      .expect(200);
    const released = await calendars.countBy({ bookingId: created[0] });
    expect(released).toBe(0);
    const afterRelease = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer ' + customerBToken)
      .send({
        roomId: room.id,
        checkInDate: '2027-02-16',
        checkOutDate: '2027-02-17',
        guestCount: 1,
      })
      .expect(201);
    bookingIds.push((afterRelease.body as Envelope<BookingPayload>).data.id);
  });

  it('creates counter bookings for existing and passwordless Customers and snapshots staff ownership', async () => {
    const room = await createRoom('Counter');
    const existing = await request(app.getHttpServer())
      .post('/api/v1/management/bookings')
      .set('Authorization', 'Bearer ' + staffToken)
      .send({
        customerId: customerB.id,
        roomId: room.id,
        checkInDate: '2027-03-01',
        checkOutDate: '2027-03-03',
        guestCount: 1,
      })
      .expect(201);
    const existingBooking = (existing.body as Envelope<BookingPayload>).data;
    bookingIds.push(existingBooking.id);
    expect(existingBooking.createdByUserId).not.toBeNull();
    expect(existingBooking.status).toBe(BookingStatus.PENDING_PAYMENT);

    const counterPhone = '091' + String(Date.now()).slice(-7);
    const created = await request(app.getHttpServer())
      .post('/api/v1/management/bookings')
      .set('Authorization', 'Bearer ' + staffToken)
      .send({
        roomId: room.id,
        checkInDate: '2027-03-05',
        checkOutDate: '2027-03-06',
        guestCount: 1,
        contactName: 'Counter Walk-in',
        contactPhone: counterPhone,
      })
      .expect(201);
    const createdBooking = (created.body as Envelope<BookingPayload>).data;
    bookingIds.push(createdBooking.id);
    const walkIn = await customers
      .createQueryBuilder('customer')
      .addSelect('customer.passwordHash')
      .where('customer.fullName = :fullName', { fullName: 'Counter Walk-in' })
      .getOne();
    if (walkIn === null) {
      throw new Error('Counter customer was not persisted.');
    }
    customerIds.push(walkIn.id);
    expect(walkIn.passwordHash).toBeNull();
    expect(createdBooking.createdByUserId).not.toBeNull();

    await request(app.getHttpServer())
      .post('/api/v1/management/bookings')
      .set('Authorization', 'Bearer ' + staffToken)
      .send({
        roomId: room.id,
        checkInDate: '2027-03-07',
        checkOutDate: '2027-03-08',
        guestCount: 1,
      })
      .expect(400);
  });

  it.each(['count', 'nights', 'same-key'] as const)(
    'serializes same-customer admission at the %s boundary with request identities',
    async (scenario) => {
      const room = await createRoom('Quota ' + scenario);
      const customer = await createCustomer('quota-' + scenario);
      const token = signCustomer(customer);
      const config = app.get(ConfigService);
      const countLimit = config.getOrThrow<number>(
        'BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER',
      );
      const nightLimit = config.getOrThrow<number>(
        'BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER',
      );
      let offset = 2;
      const stay = (nights: number) => {
        const date = (days: number) =>
          new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
        const body = {
          roomId: room.id,
          checkInDate: date(offset),
          checkOutDate: date(offset + nights),
          guestCount: 1,
        };
        offset += nights + 1;
        return body;
      };
      const submit = (body: ReturnType<typeof stay>, key: string) =>
        request(app.getHttpServer())
          .post('/api/v1/bookings')
          .set('Authorization', 'Bearer ' + token)
          .set('Idempotency-Key', key)
          .send(body);
      const initialCount = scenario === 'nights' ? 1 : countLimit - 1;
      const initialNights =
        scenario === 'nights' ? nightLimit - 1 : initialCount;
      for (let i = 0; i < initialCount; i += 1) {
        await submit(
          stay(scenario === 'nights' ? initialNights : 1),
          `quota-${customer.id}-initial-${i}`,
        ).expect(201);
      }

      // Both real transactions reach the customer lock before either proceeds.
      // An earlier non-locking intent read must not freeze admission's snapshot.
      const customerStore = app.get(BookingCustomerStore);
      const findById = customerStore.findById.bind(customerStore);
      let arrivals = 0;
      let release!: () => void;
      let rejectBarrier!: (error: Error) => void;
      const barrier = new Promise<void>((resolve, reject) => {
        release = resolve;
        rejectBarrier = reject;
      });
      const timer = setTimeout(
        () =>
          rejectBarrier(
            new Error('Concurrent requests did not reach customer lock'),
          ),
        5000,
      );
      const spy = jest
        .spyOn(customerStore, 'findById')
        .mockImplementation(async (context, id, lock) => {
          if (id === customer.id && lock) {
            arrivals += 1;
            if (arrivals === 2) release();
            await barrier;
          }
          return findById(context, id, lock);
        });
      const firstBody = stay(1);
      const secondBody = scenario === 'same-key' ? firstBody : stay(1);
      const firstKey = `quota-${customer.id}-concurrent-a`;
      try {
        const responses = await Promise.all([
          submit(firstBody, firstKey),
          submit(
            secondBody,
            scenario === 'same-key'
              ? firstKey
              : `quota-${customer.id}-concurrent-b`,
          ),
        ]);
        expect(responses.map((response) => response.status).sort()).toEqual(
          scenario === 'same-key' ? [201, 201] : [201, 409],
        );
        if (scenario === 'same-key') {
          expect((responses[0].body as Envelope<BookingPayload>).data.id).toBe(
            (responses[1].body as Envelope<BookingPayload>).data.id,
          );
          const replay = await submit(firstBody, firstKey).expect(201);
          expect((replay.body as Envelope<BookingPayload>).data.id).toBe(
            (responses[0].body as Envelope<BookingPayload>).data.id,
          );
          const conflict = await submit(
            { ...firstBody, guestCount: 2 },
            firstKey,
          ).expect(409);
          expect(conflict.body).toMatchObject({
            errorCode: ErrorCode.BOOKING_REQUEST_INTENT_CONFLICT,
          });
        } else {
          expect(
            responses.find((response) => response.status === 409)?.body,
          ).toMatchObject({
            errorCode:
              scenario === 'count'
                ? ErrorCode.BOOKING_ACTIVE_UNPAID_LIMIT_REACHED
                : ErrorCode.BOOKING_HELD_NIGHTS_LIMIT_REACHED,
          });
        }
        expect(
          await dataSource
            .getRepository(Booking)
            .countBy({ customerId: customer.id }),
        ).toBe(initialCount + 1);
        expect(await calendars.countBy({ roomId: room.id })).toBe(
          initialNights + 1,
        );
        expect(
          await dataSource.getRepository(AuditLog).countBy({
            actorId: customer.id,
            actorType: 'CUSTOMER',
            entityType: 'BOOKING',
          }),
        ).toBe(initialCount + 1);
      } finally {
        clearTimeout(timer);
        spy.mockRestore();
      }
    },
  );

  it('allows only one overlapping online booking under concurrency', async () => {
    const room = await createRoom('Concurrent');
    const firstCustomer = await createCustomer('concurrent-a-' + sequence);
    const secondCustomer = await createCustomer('concurrent-b-' + sequence);
    const tokens = [signCustomer(firstCustomer), signCustomer(secondCustomer)];
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', 'Bearer ' + tokens[0])
        .send({
          roomId: room.id,
          checkInDate: '2027-04-01',
          checkOutDate: '2027-04-03',
          guestCount: 1,
        }),
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', 'Bearer ' + tokens[1])
        .send({
          roomId: room.id,
          checkInDate: '2027-04-01',
          checkOutDate: '2027-04-03',
          guestCount: 1,
        }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const successfulIndex = responses.findIndex(
      (response) => response.status === 201,
    );
    const rejected = responses.find((response) => response.status === 409);
    expect(rejected?.body).toMatchObject({
      errorCode: ErrorCode.BOOKING_ROOM_UNAVAILABLE,
    });
    if (successfulIndex < 0) {
      throw new Error('Expected one concurrent booking request to succeed.');
    }
    const successful = responses[successfulIndex];
    const booking = (successful.body as Envelope<BookingPayload>).data;
    bookingIds.push(booking.id);
    expect(await calendars.countBy({ bookingId: booking.id })).toBe(2);

    await request(app.getHttpServer())
      .patch(`/api/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', 'Bearer ' + tokens[successfulIndex])
      .send({ reason: 'Release concurrent booking.' })
      .expect(200);
    expect(await calendars.countBy({ bookingId: booking.id })).toBe(0);

    const replacement = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer ' + tokens[successfulIndex === 0 ? 1 : 0])
      .send({
        roomId: room.id,
        checkInDate: '2027-04-01',
        checkOutDate: '2027-04-03',
        guestCount: 1,
      })
      .expect(201);
    bookingIds.push((replacement.body as Envelope<BookingPayload>).data.id);
  });

  it('allows concurrent bookings for different rooms and non-overlapping stays', async () => {
    const firstRoom = await createRoom('Concurrent independent A');
    const secondRoom = await createRoom('Concurrent independent B');
    const firstCustomer = await createCustomer('independent-a-' + sequence);
    const secondCustomer = await createCustomer('independent-b-' + sequence);
    const firstToken = signCustomer(firstCustomer);
    const secondToken = signCustomer(secondCustomer);

    const differentRooms = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', 'Bearer ' + firstToken)
        .send({
          roomId: firstRoom.id,
          checkInDate: '2027-05-01',
          checkOutDate: '2027-05-03',
          guestCount: 1,
        }),
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', 'Bearer ' + secondToken)
        .send({
          roomId: secondRoom.id,
          checkInDate: '2027-05-01',
          checkOutDate: '2027-05-03',
          guestCount: 1,
        }),
    ]);
    expect(differentRooms.map((response) => response.status)).toEqual([
      201, 201,
    ]);

    const adjacentStays = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', 'Bearer ' + firstToken)
        .send({
          roomId: firstRoom.id,
          checkInDate: '2027-05-10',
          checkOutDate: '2027-05-12',
          guestCount: 1,
        }),
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', 'Bearer ' + secondToken)
        .send({
          roomId: firstRoom.id,
          checkInDate: '2027-05-12',
          checkOutDate: '2027-05-14',
          guestCount: 1,
        }),
    ]);
    expect(adjacentStays.map((response) => response.status)).toEqual([
      201, 201,
    ]);

    for (const response of [...differentRooms, ...adjacentStays]) {
      bookingIds.push((response.body as Envelope<BookingPayload>).data.id);
    }
  });

  it('preserves management booking history after related records are soft-deleted', async () => {
    const room = await createRoom('Historical soft delete');
    const roomType = await roomTypes.findOneByOrFail({ id: room.roomTypeId });
    const customer = await createCustomer('historical-' + sequence);
    const customerToken = signCustomer(customer);
    const created = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer ' + customerToken)
      .send({
        roomId: room.id,
        checkInDate: '2027-06-01',
        checkOutDate: '2027-06-03',
        guestCount: 1,
      })
      .expect(201);
    const booking = (created.body as Envelope<BookingPayload>).data;
    bookingIds.push(booking.id);

    await customers.softDelete(customer.id);
    await rooms.softDelete(room.id);
    await roomTypes.softDelete(roomType.id);

    const history = await request(app.getHttpServer())
      .get(`/api/v1/management/bookings/${booking.id}`)
      .set('Authorization', 'Bearer ' + staffToken)
      .expect(200);

    expect((history.body as Envelope<BookingPayload>).data).toMatchObject({
      id: booking.id,
      customer: { id: customer.id, fullName: customer.fullName },
      room: {
        id: room.id,
        name: room.name,
        roomType: { id: roomType.id, name: roomType.name },
      },
    });
  });

  async function createRoom(label: string): Promise<Room> {
    const roomType = await roomTypes.save(
      roomTypes.create({
        name: 'Booking ' + label + ' ' + suffix + '-' + sequence,
        description: null,
        maxGuests: 2,
        basePrice: '125.00',
        amenities: [],
      }),
    );
    roomTypeIds.push(roomType.id);
    sequence += 1;
    const room = await rooms.save(
      rooms.create({
        roomTypeId: roomType.id,
        roomNumber: 'BK-' + suffix + '-' + sequence,
        name: 'Booking room ' + label,
        description: null,
        status: RoomStatus.READY,
      }),
    );
    roomIds.push(room.id);
    return room;
  }

  async function createUser(role: 'ADMIN' | 'STAFF'): Promise<User> {
    const user = await users.save(
      users.create({
        fullName: 'Booking ' + role,
        email: 'booking-' + role.toLowerCase() + '-' + suffix + '@example.com',
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

  async function createCustomer(label: string): Promise<Customer> {
    sequence += 1;
    const customer = await customers.save(
      customers.create({
        fullName: 'Booking Customer ' + label,
        email: 'booking-customer-' + label + '-' + suffix + '@example.com',
        phone: '09' + String(Date.now() + sequence).slice(-8),
        passwordHash: await hasher.hash(PASSWORD),
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

  function signCustomer(customer: Customer): string {
    return accessTokens.sign({
      actorType: 'customer',
      customerId: customer.id,
      tokenVersion: customer.tokenVersion,
    });
  }

  function placeholders(values: string[]): string {
    return values.map(() => '?').join(', ');
  }
});
