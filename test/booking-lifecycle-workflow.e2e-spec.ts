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
import {
  Booking,
  BookingPaymentStatus,
  BookingStatus,
} from '../src/module/booking/schema/booking.entity';
import { BookingService } from '../src/module/booking/booking.service';
import { ErrorCode } from '../src/common/http';
import {
  RoomCalendar,
  RoomCalendarStatus,
} from '../src/module/booking/schema/room-calendar.entity';
import { Customer } from '../src/module/customer/schema/customer.entity';
import { Room, RoomStatus } from '../src/module/room/schema/room.entity';
import { RoomType } from '../src/module/room-type/schema/room-type.entity';
import { User } from '../src/module/user/schema/user.entity';
import { E2eHarness } from './e2e-harness';

const PASSWORD = 'StrongPassword123!';
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

interface Envelope<T> {
  data: T;
}

interface BookingPayload {
  id: string;
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  cancellationReason: string | null;
}

interface ManagementBookingCapabilityPayload {
  credentialCapabilities: {
    canSetInitialPassword: boolean;
    reasonCode: string;
  };
  transitionCapabilities: Array<{
    allowed: boolean;
    reasonCode?: string;
    targetStatus: BookingStatus;
  }>;
}

describe('Booking lifecycle/expiration workflow (e2e)', () => {
  let app: INestApplication<App>;
  let harness: E2eHarness | undefined;
  let dataSource: DataSource;
  let rooms: Repository<Room>;
  let roomTypes: Repository<RoomType>;
  let bookings: Repository<Booking>;
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
  const calendarIds: string[] = [];
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
    bookings = dataSource.getRepository(Booking);
    calendars = dataSource.getRepository(RoomCalendar);
    customers = dataSource.getRepository(Customer);
    users = dataSource.getRepository(User);
    hasher = app.get(PasswordHasherService);
    accessTokens = app.get(AccessTokenService);

    const staff = await createUser();
    customerA = await createCustomer('A');
    customerB = await createCustomer('B');
    staffToken = signUser(staff);
    customerAToken = signCustomer(customerA);
    customerBToken = signCustomer(customerB);

    harness.registerCleanup(async () => {
      if (bookingIds.length > 0) {
        await dataSource.query(
          `DELETE FROM room_calendar WHERE booking_id IN (${placeholders(bookingIds)})`,
          bookingIds,
        );
      }
      if (roomIds.length > 0) {
        await dataSource.query(
          `DELETE FROM room_calendar WHERE room_id IN (${placeholders(roomIds)})`,
          roomIds,
        );
      }
      if (bookingIds.length > 0) {
        await dataSource.query(
          `DELETE FROM bookings WHERE id IN (${placeholders(bookingIds)})`,
          bookingIds,
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

  it('enforces payment/state transitions and moves Room READY → OCCUPIED → CLEANING', async () => {
    const room = await createRoom('state');
    const onlineUnpaid = await createBooking({
      roomId: room.id,
      status: BookingStatus.PENDING_PAYMENT,
      paymentStatus: BookingPaymentStatus.UNPAID,
      createdByUserId: null,
      checkInDate: addDays(todayVietnam(), 10),
      checkOutDate: addDays(todayVietnam(), 12),
    });
    const deniedConfirmation = await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${onlineUnpaid.id}/status`)
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ status: BookingStatus.CONFIRMED })
      .expect(409);
    expect(deniedConfirmation.body).toMatchObject({
      errorCode: ErrorCode.BOOKING_CONFIRMATION_REQUIRES_PAYMENT,
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/management/bookings/${onlineUnpaid.id}`)
      .set('Authorization', 'Bearer ' + staffToken)
      .expect(200);
    const detailBody =
      detail.body as Envelope<ManagementBookingCapabilityPayload>;
    expect(detailBody.data).toMatchObject({
      credentialCapabilities: {
        canSetInitialPassword: false,
        reasonCode: ErrorCode.CUSTOMER_INITIAL_PASSWORD_ALREADY_CONFIGURED,
      },
    });
    expect(detailBody.data.transitionCapabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          allowed: false,
          reasonCode: ErrorCode.BOOKING_CONFIRMATION_REQUIRES_PAYMENT,
          targetStatus: BookingStatus.CONFIRMED,
        }),
      ]),
    );

    const counterUnpaid = await createBooking({
      roomId: room.id,
      status: BookingStatus.PENDING_PAYMENT,
      paymentStatus: BookingPaymentStatus.UNPAID,
      createdByUserId: userIds[0],
      checkInDate: addDays(todayVietnam(), 20),
      checkOutDate: addDays(todayVietnam(), 22),
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${counterUnpaid.id}/status`)
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ status: BookingStatus.CONFIRMED })
      .expect(200);

    const missingCancellationReason = await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${counterUnpaid.id}/status`)
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ status: BookingStatus.CANCELLED })
      .expect(400);
    expect(missingCancellationReason.body).toMatchObject({
      errorCode: ErrorCode.BOOKING_CANCELLATION_REASON_REQUIRED,
      fieldErrors: {
        cancellationReason: [
          {
            errorCode: ErrorCode.BOOKING_CANCELLATION_REASON_REQUIRED,
          },
        ],
      },
    });

    const futurePaid = await createBooking({
      roomId: room.id,
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
      createdByUserId: userIds[0],
      checkInDate: addDays(todayVietnam(), 2),
      checkOutDate: addDays(todayVietnam(), 4),
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${futurePaid.id}/status`)
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ status: BookingStatus.CHECKED_IN })
      .expect(409);

    const stay = await createBooking({
      roomId: room.id,
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
      createdByUserId: userIds[0],
      checkInDate: todayVietnam(),
      checkOutDate: addDays(todayVietnam(), 5),
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${stay.id}/status`)
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ status: BookingStatus.CHECKED_IN })
      .expect(200);
    expect((await rooms.findOneByOrFail({ id: room.id })).status).toBe(
      RoomStatus.OCCUPIED,
    );
    await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${stay.id}/status`)
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ status: BookingStatus.CHECKED_OUT })
      .expect(200);
    expect((await rooms.findOneByOrFail({ id: room.id })).status).toBe(
      RoomStatus.CLEANING,
    );
  });

  it('enforces customer ownership, unpaid cancellation, paid protection, and calendar release', async () => {
    const room = await createRoom('cancel');
    const unpaid = await createBooking({
      roomId: room.id,
      status: BookingStatus.PENDING_PAYMENT,
      paymentStatus: BookingPaymentStatus.UNPAID,
      createdByUserId: null,
      checkInDate: addDays(todayVietnam(), 30),
      checkOutDate: addDays(todayVietnam(), 32),
    });
    const calendar = await calendars.save(
      calendars.create({
        roomId: room.id,
        bookingId: unpaid.id,
        stayDate: addDays(todayVietnam(), 30),
        status: RoomCalendarStatus.RESERVED,
        reason: null,
      }),
    );
    calendarIds.push(calendar.id);

    await request(app.getHttpServer())
      .patch(`/api/v1/bookings/${unpaid.id}/cancel`)
      .set('Authorization', 'Bearer ' + customerBToken)
      .send({ reason: 'Not the owner' })
      .expect(404);
    const cancelled = await request(app.getHttpServer())
      .patch(`/api/v1/bookings/${unpaid.id}/cancel`)
      .set('Authorization', 'Bearer ' + customerAToken)
      .send({ reason: '  Changed plans  ' })
      .expect(200);
    expect((cancelled.body as Envelope<BookingPayload>).data).toMatchObject({
      status: BookingStatus.CANCELLED,
      cancellationReason: 'Changed plans',
    });
    expect(await calendars.countBy({ bookingId: unpaid.id })).toBe(0);

    const paid = await createBooking({
      roomId: room.id,
      status: BookingStatus.PENDING_PAYMENT,
      paymentStatus: BookingPaymentStatus.PAID,
      createdByUserId: userIds[0],
      checkInDate: addDays(todayVietnam(), 40),
      checkOutDate: addDays(todayVietnam(), 42),
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/bookings/${paid.id}/cancel`)
      .set('Authorization', 'Bearer ' + customerAToken)
      .send({ reason: 'Paid booking' })
      .expect(409);
  });

  it('keeps CHECKED_OUT and CANCELLED terminal and characterizes early checkout', async () => {
    const room = await createRoom('terminal');
    const terminal = await createBooking({
      roomId: room.id,
      status: BookingStatus.CHECKED_OUT,
      paymentStatus: BookingPaymentStatus.PAID,
      createdByUserId: userIds[0],
      checkInDate: todayVietnam(),
      checkOutDate: addDays(todayVietnam(), 5),
    });
    for (const status of [
      BookingStatus.PENDING_PAYMENT,
      BookingStatus.CONFIRMED,
      BookingStatus.CHECKED_IN,
      BookingStatus.CANCELLED,
    ]) {
      await request(app.getHttpServer())
        .patch(`/api/v1/management/bookings/${terminal.id}/status`)
        .set('Authorization', 'Bearer ' + staffToken)
        .send({ status })
        .expect(409);
    }
    await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${terminal.id}/status`)
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ status: BookingStatus.CHECKED_OUT })
      .expect(200);

    const cancelled = await createBooking({
      roomId: room.id,
      status: BookingStatus.CANCELLED,
      paymentStatus: BookingPaymentStatus.UNPAID,
      createdByUserId: null,
      checkInDate: addDays(todayVietnam(), 50),
      checkOutDate: addDays(todayVietnam(), 52),
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${cancelled.id}/status`)
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ status: BookingStatus.CANCELLED })
      .expect(200);

    const early = await createBooking({
      roomId: room.id,
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
      createdByUserId: userIds[0],
      checkInDate: todayVietnam(),
      checkOutDate: addDays(todayVietnam(), 5),
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${early.id}/status`)
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ status: BookingStatus.CHECKED_IN })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/management/bookings/${early.id}/status`)
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ status: BookingStatus.CHECKED_OUT })
      .expect(200);
  });

  it('expires only pending unpaid bookings in batches and releases their calendars', async () => {
    const room = await createRoom('expiry');
    const expired = await createBooking({
      roomId: room.id,
      status: BookingStatus.PENDING_PAYMENT,
      paymentStatus: BookingPaymentStatus.UNPAID,
      createdByUserId: null,
      checkInDate: addDays(todayVietnam(), 60),
      checkOutDate: addDays(todayVietnam(), 62),
      paymentExpiresAt: new Date(Date.now() - 1000),
    });
    const calendar = await calendars.save(
      calendars.create({
        roomId: room.id,
        bookingId: expired.id,
        stayDate: addDays(todayVietnam(), 60),
        status: RoomCalendarStatus.RESERVED,
        reason: null,
      }),
    );
    calendarIds.push(calendar.id);

    const bookingService = app.get(BookingService);
    const expiredCount = await bookingService.expirePendingPayments(new Date());
    expect(expiredCount).toBeGreaterThanOrEqual(1);
    expect(await bookings.findOneByOrFail({ id: expired.id })).toMatchObject({
      status: BookingStatus.CANCELLED,
      paymentExpiresAt: null,
      cancellationReason: 'Thanh toán đã hết hạn.',
    });
    expect(await calendars.countBy({ bookingId: expired.id })).toBe(0);
    await expect(
      bookingService.expirePendingPayments(new Date()),
    ).resolves.toBe(0);
  });

  async function createRoom(label: string): Promise<Room> {
    const roomType = await roomTypes.save(
      roomTypes.create({
        name: 'Lifecycle ' + label + ' ' + suffix + '-' + sequence,
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
        roomNumber: 'BL-' + suffix + '-' + sequence,
        name: 'Lifecycle room ' + label,
        description: null,
        status: RoomStatus.READY,
      }),
    );
    roomIds.push(room.id);
    return room;
  }

  async function createBooking(input: {
    roomId: string;
    status: BookingStatus;
    paymentStatus: BookingPaymentStatus;
    createdByUserId: string | null;
    checkInDate: string;
    checkOutDate: string;
    paymentExpiresAt?: Date;
  }): Promise<Booking> {
    sequence += 1;
    const booking = await bookings.save(
      bookings.create({
        bookingCode:
          'BL-' +
          suffix.replace(/[^A-Za-z0-9]/g, '').slice(-24) +
          '-' +
          sequence,
        customerId: customerA.id,
        roomId: input.roomId,
        createdByUserId: input.createdByUserId,
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        guestCount: 1,
        contactName: customerA.fullName,
        contactPhone: customerA.phone,
        contactEmail: customerA.email,
        totalAmount: '100.00',
        status: input.status,
        paymentStatus: input.paymentStatus,
        paymentExpiresAt: input.paymentExpiresAt ?? null,
        customerNote: null,
        cancelledAt:
          input.status === BookingStatus.CANCELLED ? new Date() : null,
        cancellationReason: null,
      }),
    );
    bookingIds.push(booking.id);
    return booking;
  }

  async function createUser(): Promise<User> {
    const user = await users.save(
      users.create({
        fullName: 'Lifecycle Staff',
        email: 'lifecycle-staff-' + suffix + '@example.com',
        phone: null,
        passwordHash: await hasher.hash(PASSWORD),
        tokenVersion: 0,
        role: 'STAFF',
        status: 'ACTIVE',
      }),
    );
    userIds.push(user.id);
    return user;
  }

  async function createCustomer(label: string): Promise<Customer> {
    const customer = await customers.save(
      customers.create({
        fullName: 'Lifecycle Customer ' + label,
        email: 'lifecycle-customer-' + label + '-' + suffix + '@example.com',
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

  function todayVietnam(): string {
    return new Date(Date.now() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
  }

  function addDays(value: string, days: number): string {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function placeholders(values: string[]): string {
    return values.map(() => '?').join(', ');
  }
});
