import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import migrationDataSource from '../../src/database/data-source';
import {
  Booking,
  BookingPaymentStatus,
  BookingStatus,
} from '../../src/module/booking/schema/booking.entity';
import {
  RoomCalendar,
  RoomCalendarStatus,
} from '../../src/module/booking/schema/room-calendar.entity';
import { Customer } from '../../src/module/customer/schema/customer.entity';
import {
  Payment,
  PaymentMethod,
  PaymentStatus,
} from '../../src/module/payment/schema/payment.entity';
import { Room, RoomStatus } from '../../src/module/room/schema/room.entity';
import { RoomType } from '../../src/module/room-type/schema/room-type.entity';
import { AccessTokenService } from '../../src/module/auth/access-token.service';
import { User } from '../../src/module/user/schema/user.entity';
import { E2eHarness } from '../e2e-harness';

interface DashboardBody {
  data: {
    bookings: Record<string, number>;
    rooms: Record<string, number>;
    revenue: { manual: number; vnpay: number; total: number };
    totalRefunded: number;
    payments: { requiresReview: number; refundPending: number };
    occupancy: {
      roomNightsReserved: number;
      roomNightsAvailable: number;
      occupancyRate: number;
    };
  };
}

describe('Dashboard workflow (e2e)', () => {
  let app: INestApplication<App>;
  let harness: E2eHarness | undefined;
  let dataSource: DataSource;
  let users: Repository<User>;
  let customers: Repository<Customer>;
  let roomTypes: Repository<RoomType>;
  let rooms: Repository<Room>;
  let bookings: Repository<Booking>;
  let payments: Repository<Payment>;
  let calendars: Repository<RoomCalendar>;
  let staffToken: string;
  const suffix = E2eHarness.createUniqueSuffix();
  const userIds: string[] = [];
  const customerIds: string[] = [];
  const roomTypeIds: string[] = [];
  const roomIds: string[] = [];
  const bookingIds: string[] = [];
  const paymentIds: string[] = [];

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
    users = dataSource.getRepository(User);
    customers = dataSource.getRepository(Customer);
    roomTypes = dataSource.getRepository(RoomType);
    rooms = dataSource.getRepository(Room);
    bookings = dataSource.getRepository(Booking);
    payments = dataSource.getRepository(Payment);
    calendars = dataSource.getRepository(RoomCalendar);

    const staff = await users.save(
      users.create({
        fullName: 'Dashboard workflow staff',
        email: `dashboard-staff-${suffix}@example.com`,
        phone: null,
        passwordHash: 'fixture-password-hash',
        tokenVersion: 0,
        role: 'STAFF',
        status: 'ACTIVE',
      }),
    );
    userIds.push(staff.id);
    staffToken = app.get(AccessTokenService).sign({
      actorType: 'user',
      userId: staff.id,
      role: 'STAFF',
      tokenVersion: staff.tokenVersion,
    });

    const customer = await customers.save(
      customers.create({
        fullName: 'Dashboard workflow customer',
        email: `dashboard-customer-${suffix}@example.com`,
        phone: '09' + String(Date.now()).slice(-8),
        passwordHash: null,
        tokenVersion: 0,
        status: 'ACTIVE',
      }),
    );
    customerIds.push(customer.id);

    harness.registerCleanup(async () => {
      if (paymentIds.length > 0)
        await payments.delete([...new Set(paymentIds)]);
      for (const bookingId of [...new Set(bookingIds)]) {
        await calendars.delete({ bookingId });
      }
      if (roomIds.length > 0) {
        await calendars.delete(roomIds.map((roomId) => ({ roomId })));
      }
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

  it('enforces date validation and accepts the exact 366-day inclusive range', async () => {
    const base = '/api/v1/management/dashboard/summary';
    await request(app.getHttpServer())
      .get(`${base}?from=2038-02-30&to=2038-03-01`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(400);
    await request(app.getHttpServer())
      .get(`${base}?from=2038-01-01&to=2039-01-02`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(400);

    const response = await request(app.getHttpServer())
      .get(`${base}?from=2038-01-01&to=2039-01-01`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    const body = response.body as DashboardBody;
    expect(body.data).toMatchObject({
      bookings: expect.any(Object) as Record<string, number>,
      occupancy: expect.any(Object) as Record<string, number>,
    });
  });

  it('uses +07 boundaries and separates collected, refunded, review, and occupancy metrics', async () => {
    const path =
      '/api/v1/management/dashboard/summary?from=2038-01-01&to=2038-01-01';
    const before = (
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200)
    ).body as DashboardBody;
    const customer = await customers.findOneByOrFail({ id: customerIds[0] });

    const ready = await createRoom(RoomStatus.READY, 'ready');
    const maintenance = await createRoom(RoomStatus.MAINTENANCE, 'maintenance');
    const hidden = await createRoom(RoomStatus.HIDDEN, 'hidden');
    const activeBooking = await createBooking(
      ready.id,
      customer,
      BookingStatus.CONFIRMED,
      BookingPaymentStatus.PAID,
      'active',
    );
    const cancelledBooking = await createBooking(
      hidden.id,
      customer,
      BookingStatus.CANCELLED,
      BookingPaymentStatus.REFUNDED,
      'cancelled',
    );
    await calendars.save(
      calendars.create({
        roomId: ready.id,
        bookingId: activeBooking.id,
        stayDate: '2038-01-01',
        status: RoomCalendarStatus.RESERVED,
        reason: null,
      }),
    );
    await calendars.save(
      calendars.create({
        roomId: maintenance.id,
        bookingId: null,
        stayDate: '2038-01-01',
        status: RoomCalendarStatus.BLOCKED,
        reason: 'maintenance',
      }),
    );
    await calendars.save(
      calendars.create({
        roomId: hidden.id,
        bookingId: null,
        stayDate: '2038-01-01',
        status: RoomCalendarStatus.BLOCKED,
        reason: 'hidden inventory',
      }),
    );

    await createPayment(
      activeBooking,
      PaymentStatus.SUCCESS,
      PaymentMethod.CASH,
      {
        paidAt: new Date('2037-12-31T17:00:00.000Z'),
        marker: 'collected-boundary',
      },
    );
    await createPayment(
      cancelledBooking,
      PaymentStatus.REFUNDED,
      PaymentMethod.BANK_TRANSFER,
      {
        refundedAt: new Date('2038-01-01T12:00:00.000Z'),
        marker: 'refunded-in-range',
      },
    );
    await createPayment(
      activeBooking,
      PaymentStatus.REQUIRES_REVIEW,
      PaymentMethod.VNPAY,
      {
        marker: 'review-in-range',
      },
    );
    await createPayment(
      activeBooking,
      PaymentStatus.REFUND_PENDING,
      PaymentMethod.VNPAY,
      {
        marker: 'pending-in-range',
      },
    );
    await bookings.update([activeBooking.id, cancelledBooking.id], {
      createdAt: new Date('2038-01-01T12:00:00.000Z'),
    });
    await payments.update(paymentIds, {
      createdAt: new Date('2038-01-01T12:00:00.000Z'),
    });

    const after = (
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200)
    ).body as DashboardBody;

    expect(after.data.bookings.confirmed - before.data.bookings.confirmed).toBe(
      1,
    );
    expect(after.data.bookings.cancelled - before.data.bookings.cancelled).toBe(
      1,
    );
    expect(after.data.revenue.manual - before.data.revenue.manual).toBe(100);
    expect(after.data.revenue.total - before.data.revenue.total).toBe(100);
    expect(after.data.totalRefunded - before.data.totalRefunded).toBe(100);
    expect(
      after.data.payments.requiresReview - before.data.payments.requiresReview,
    ).toBe(1);
    expect(
      after.data.payments.refundPending - before.data.payments.refundPending,
    ).toBe(1);
    expect(after.data.rooms.ready - before.data.rooms.ready).toBe(1);
    expect(after.data.rooms.maintenance - before.data.rooms.maintenance).toBe(
      1,
    );
    expect(
      after.data.occupancy.roomNightsReserved -
        before.data.occupancy.roomNightsReserved,
    ).toBe(1);
    expect(
      after.data.occupancy.roomNightsAvailable -
        before.data.occupancy.roomNightsAvailable,
    ).toBe(1);
    expect(after.data.occupancy.occupancyRate).toBeGreaterThanOrEqual(0);
    expect(after.data.occupancy.occupancyRate).toBeLessThanOrEqual(100);
  });

  async function createRoom(status: RoomStatus, label: string): Promise<Room> {
    const roomType = await roomTypes.save(
      roomTypes.create({
        name: `Dashboard ${label} type ${suffix}-${roomTypeIds.length}`,
        description: null,
        maxGuests: 2,
        basePrice: '100.00',
        amenities: [],
      }),
    );
    roomTypeIds.push(roomType.id);
    const room = await rooms.save(
      rooms.create({
        roomTypeId: roomType.id,
        roomNumber: `DB-${label}-${suffix}-${roomIds.length}`,
        name: `Dashboard ${label} room`,
        description: null,
        status,
      }),
    );
    roomIds.push(room.id);
    return room;
  }

  async function createBooking(
    roomId: string,
    customer: Customer,
    status: BookingStatus,
    paymentStatus: BookingPaymentStatus,
    label: string,
  ): Promise<Booking> {
    const booking = await bookings.save(
      bookings.create({
        bookingCode: `DB-${label}-${suffix.replace(/[^A-Za-z0-9]/g, '').slice(-24)}-${bookingIds.length}`,
        customerId: customer.id,
        roomId,
        createdByUserId: null,
        checkInDate: '2038-01-01',
        checkOutDate: '2038-01-02',
        guestCount: 1,
        contactName: customer.fullName,
        contactPhone: customer.phone,
        contactEmail: customer.email,
        totalAmount: '100.00',
        status,
        paymentStatus,
        paymentExpiresAt: null,
        customerNote: null,
        cancelledAt: status === BookingStatus.CANCELLED ? new Date() : null,
        cancellationReason:
          status === BookingStatus.CANCELLED ? 'fixture' : null,
      }),
    );
    bookingIds.push(booking.id);
    return booking;
  }

  async function createPayment(
    booking: Booking,
    status: PaymentStatus,
    method: PaymentMethod,
    values: { paidAt?: Date; refundedAt?: Date; marker: string },
  ): Promise<Payment> {
    const payment = await payments.save(
      payments.create({
        bookingId: booking.id,
        amount: '100.00',
        currency: 'VND',
        method,
        status,
        gatewayName: method === PaymentMethod.VNPAY ? 'VNPAY' : null,
        gatewayReference: values.marker,
        gatewayTransactionId: null,
        gatewayPaymentUrl: null,
        gatewayResponseCode: null,
        gatewayTransactionStatus: null,
        gatewayTransactionDate: null,
        idempotencyKey: `db-${values.marker}-${suffix}`,
        refundIdempotencyKey: null,
        refundRequestId: null,
        refundPreviousStatus: null,
        refundGatewayTransactionId: null,
        refundResponseCode: null,
        refundTransactionStatus: null,
        refundMessage: null,
        refundReason: null,
        createdByUserId: null,
        refundedByUserId: null,
        paidAt: values.paidAt ?? null,
        refundedAt: values.refundedAt ?? null,
        refundRequestedAt: null,
        refundLastQueriedAt: null,
        expiresAt: null,
      }),
    );
    paymentIds.push(payment.id);
    return payment;
  }
});
