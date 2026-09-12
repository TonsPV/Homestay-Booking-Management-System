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
import { Booking } from '../../src/module/booking/schema/booking.entity';
import { Customer } from '../../src/module/customer/schema/customer.entity';
import { Payment } from '../../src/module/payment/schema/payment.entity';
import {
  PaymentMethod,
  PaymentStatus,
} from '../../src/module/payment/domain/payment-state';
import { Room } from '../../src/module/room/schema/room.entity';
import { RoomStatus } from '../../src/module/room/domain/room-status';
import { RoomType } from '../../src/module/room-type/schema/room-type.entity';
import { User } from '../../src/module/user/schema/user.entity';
import { E2eHarness } from '../e2e-harness';

const PASSWORD = 'StrongPassword123!';

interface Envelope<T> {
  data: T;
  meta?: { pagination: Record<string, number>; staleRefundCount?: number };
}

interface PaymentPayload {
  id: string;
  bookingId: string;
  amount: string;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  createdByUserId: string | null;
  gatewayName?: string | null;
  gatewayReference?: string | null;
}

interface BookingPayload {
  id: string;
  totalAmount: string;
  status: string;
  paymentStatus: string;
}

describe('Payment query/manual workflow (e2e)', () => {
  let app: INestApplication<App>;
  let harness: E2eHarness | undefined;
  let dataSource: DataSource;
  let rooms: Repository<Room>;
  let roomTypes: Repository<RoomType>;
  let bookings: Repository<Booking>;
  let payments: Repository<Payment>;
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
  const paymentIds: string[] = [];
  const userIds: string[] = [];
  const customerIds: string[] = [];
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
    payments = dataSource.getRepository(Payment);
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
      if (bookingIds.length > 0)
        await bookings.update([...new Set(bookingIds)], {
          acceptedPaymentId: null,
        });
      if (paymentIds.length > 0)
        await payments.delete([...new Set(paymentIds)]);
      if (bookingIds.length > 0) {
        await dataSource.query(
          `DELETE FROM room_calendar WHERE booking_id IN (${placeholders(bookingIds)})`,
          bookingIds,
        );
        await bookings.delete([...new Set(bookingIds)]);
      }
      if (roomIds.length > 0) {
        await dataSource.query(
          `DELETE FROM room_calendar WHERE room_id IN (${placeholders(roomIds)})`,
          roomIds,
        );
        await rooms.delete([...new Set(roomIds)]);
      }
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

  it('records a manual payment atomically, auto-confirms, and replays idempotently', async () => {
    const room = await createRoom('manual');
    const booking = await createBooking(
      customerAToken,
      room,
      '2027-05-01',
      '2027-05-03',
    );
    const key = 'manual-' + suffix;

    await request(app.getHttpServer())
      .post(`/api/v1/management/bookings/${booking.id}/payments`)
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ method: PaymentMethod.CASH })
      .expect(400);
    const response = await request(app.getHttpServer())
      .post(`/api/v1/management/bookings/${booking.id}/payments`)
      .set('Authorization', 'Bearer ' + staffToken)
      .set('Idempotency-Key', key)
      .send({ method: PaymentMethod.CASH })
      .expect(201);
    const payment = (response.body as Envelope<PaymentPayload>).data;
    paymentIds.push(payment.id);
    expect(payment).toMatchObject({
      bookingId: booking.id,
      amount: '200.00',
      currency: 'VND',
      method: PaymentMethod.CASH,
      status: PaymentStatus.SUCCESS,
    });
    expect(typeof payment.createdByUserId).toBe('string');
    const replay = await request(app.getHttpServer())
      .post(`/api/v1/management/bookings/${booking.id}/payments`)
      .set('Authorization', 'Bearer ' + staffToken)
      .set('Idempotency-Key', key)
      .send({ method: PaymentMethod.CASH })
      .expect(201);
    expect((replay.body as Envelope<PaymentPayload>).data.id).toBe(payment.id);

    await request(app.getHttpServer())
      .post(`/api/v1/management/bookings/${booking.id}/payments`)
      .set('Authorization', 'Bearer ' + staffToken)
      .set('Idempotency-Key', key)
      .send({ method: PaymentMethod.BANK_TRANSFER })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/management/bookings/${booking.id}/payments`)
      .set('Authorization', 'Bearer ' + customerAToken)
      .set('Idempotency-Key', 'customer-denied-' + suffix)
      .send({ method: PaymentMethod.CASH })
      .expect(403);

    const managementBooking = await request(app.getHttpServer())
      .get(`/api/v1/management/bookings/${booking.id}`)
      .set('Authorization', 'Bearer ' + staffToken)
      .expect(200);
    expect(
      (managementBooking.body as Envelope<BookingPayload>).data,
    ).toMatchObject({
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
    });
  });

  it('separates customer payment projection/ownership from management lists', async () => {
    const room = await createRoom('query');
    const booking = await createBooking(
      customerAToken,
      room,
      '2027-06-01',
      '2027-06-02',
    );
    const response = await request(app.getHttpServer())
      .post(`/api/v1/management/bookings/${booking.id}/payments`)
      .set('Authorization', 'Bearer ' + staffToken)
      .set('Idempotency-Key', 'query-payment-' + suffix)
      .send({ method: PaymentMethod.BANK_TRANSFER })
      .expect(201);
    const payment = (response.body as Envelope<PaymentPayload>).data;
    paymentIds.push(payment.id);

    const directManagementPayment = await request(app.getHttpServer())
      .get(`/api/v1/management/payments/${payment.id}`)
      .set('Authorization', 'Bearer ' + staffToken)
      .expect(200);
    expect(
      (directManagementPayment.body as Envelope<PaymentPayload>).data,
    ).toMatchObject({
      id: payment.id,
      bookingId: booking.id,
      method: PaymentMethod.BANK_TRANSFER,
    });

    const customerList = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${booking.id}/payments`)
      .set('Authorization', 'Bearer ' + customerAToken)
      .expect(200);
    const customerPayment = (customerList.body as Envelope<PaymentPayload[]>)
      .data[0];
    expect(customerPayment).toMatchObject({
      id: payment.id,
      bookingId: booking.id,
      method: PaymentMethod.BANK_TRANSFER,
      status: PaymentStatus.SUCCESS,
    });
    expect(customerPayment).not.toHaveProperty('gatewayName');
    expect(customerPayment).not.toHaveProperty('createdByUserId');
    await request(app.getHttpServer())
      .get(`/api/v1/bookings/${booking.id}/payments`)
      .set('Authorization', 'Bearer ' + customerBToken)
      .expect(404);

    const managementList = await request(app.getHttpServer())
      .get(`/api/v1/management/bookings/${booking.id}/payments`)
      .set('Authorization', 'Bearer ' + staffToken)
      .expect(200);
    expect(
      (managementList.body as Envelope<PaymentPayload[]>).data.map(
        (item) => item.id,
      ),
    ).toContain(payment.id);
    const allManagement = await request(app.getHttpServer())
      .get('/api/v1/management/payments')
      .query({ status: PaymentStatus.SUCCESS, limit: 100 })
      .set('Authorization', 'Bearer ' + staffToken)
      .expect(200);
    expect(
      typeof (allManagement.body as Envelope<PaymentPayload[]>).meta
        ?.staleRefundCount,
    ).toBe('number');
  });

  it('rejects manual payment while a VNPay attempt is pending and allows only one concurrent success', async () => {
    const pendingRoom = await createRoom('pending-vnpay');
    const pendingBooking = await createBooking(
      customerAToken,
      pendingRoom,
      '2027-07-01',
      '2027-07-02',
    );
    const pending = await payments.save(
      payments.create({
        bookingId: pendingBooking.id,
        amount: '100.00',
        currency: 'VND',
        method: PaymentMethod.VNPAY,
        status: PaymentStatus.PENDING,
        gatewayName: 'VNPay',
        gatewayReference: 'pending-' + suffix,
        gatewayTransactionId: null,
        gatewayPaymentUrl: 'https://sandbox.example/pay',
        gatewayResponseCode: null,
        gatewayTransactionStatus: null,
        gatewayTransactionDate: null,
        idempotencyKey: 'pending-vnpay-' + suffix,
        createdByUserId: null,
        paidAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    paymentIds.push(pending.id);
    await request(app.getHttpServer())
      .get(`/api/v1/management/payments/${pending.id}`)
      .set('Authorization', 'Bearer ' + staffToken)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/management/bookings/${pendingBooking.id}/payments`)
      .set('Authorization', 'Bearer ' + staffToken)
      .set('Idempotency-Key', 'manual-pending-' + suffix)
      .send({ method: PaymentMethod.CASH })
      .expect(409);

    const concurrentRoom = await createRoom('concurrent');
    const concurrentBooking = await createBooking(
      customerBToken,
      concurrentRoom,
      '2027-08-01',
      '2027-08-02',
    );
    const concurrentKey = 'concurrent-manual-' + suffix;
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/management/bookings/${concurrentBooking.id}/payments`)
        .set('Authorization', 'Bearer ' + staffToken)
        .set('Idempotency-Key', concurrentKey)
        .send({ method: PaymentMethod.CASH }),
      request(app.getHttpServer())
        .post(`/api/v1/management/bookings/${concurrentBooking.id}/payments`)
        .set('Authorization', 'Bearer ' + staffToken)
        .set('Idempotency-Key', concurrentKey)
        .send({ method: PaymentMethod.CASH }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const ids = responses.map(
      (response) => (response.body as Envelope<PaymentPayload>).data.id,
    );
    expect(ids[0]).toBe(ids[1]);
    paymentIds.push(ids[0]);
    expect(
      await payments.countBy({
        bookingId: concurrentBooking.id,
        status: PaymentStatus.SUCCESS,
      }),
    ).toBe(1);
  });

  async function createRoom(label: string): Promise<Room> {
    const roomType = await roomTypes.save(
      roomTypes.create({
        name: 'Payment ' + label + ' ' + suffix + '-' + sequence,
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
        roomNumber: 'PM-' + suffix + '-' + sequence,
        name: 'Payment room ' + label,
        description: null,
        status: RoomStatus.READY,
      }),
    );
    roomIds.push(room.id);
    return room;
  }

  async function createBooking(
    token: string,
    room: Room,
    from: string,
    to: string,
  ): Promise<BookingPayload> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer ' + token)
      .send({
        roomId: room.id,
        checkInDate: from,
        checkOutDate: to,
        guestCount: 1,
      })
      .expect(201);
    const booking = (response.body as Envelope<BookingPayload>).data;
    bookingIds.push(booking.id);
    return booking;
  }

  async function createUser(): Promise<User> {
    const user = await users.save(
      users.create({
        fullName: 'Payment Staff',
        email: 'payment-staff-' + suffix + '@example.com',
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
        fullName: 'Payment Customer ' + label,
        email: 'payment-customer-' + label + '-' + suffix + '@example.com',
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
