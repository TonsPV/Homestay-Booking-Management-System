import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import migrationDataSource from '../../src/database/data-source';
import { Booking } from '../../src/module/booking/schema/booking.entity';
import {
  BookingPaymentStatus,
  BookingStatus,
} from '../../src/module/booking/domain/booking-state';
import { Customer } from '../../src/module/customer/schema/customer.entity';
import { Payment } from '../../src/module/payment/schema/payment.entity';
import {
  PaymentMethod,
  PaymentReviewReason,
  PaymentStatus,
} from '../../src/module/payment/domain/payment-state';
import {
  createVnPaySignature,
  formatVnPayDate,
} from '../../src/module/payment/vnpay-gateway.service';
import { Room } from '../../src/module/room/schema/room.entity';
import { RoomStatus } from '../../src/module/room/domain/room-status';
import { RoomType } from '../../src/module/room-type/schema/room-type.entity';
import { E2eHarness } from '../e2e-harness';

interface VnPayResponse {
  RspCode: string;
  Message: string;
}

describe('VNPay collection/Return/IPN workflow (e2e)', () => {
  let app: INestApplication<App>;
  let harness: E2eHarness | undefined;
  let dataSource: DataSource;
  let rooms: Repository<Room>;
  let roomTypes: Repository<RoomType>;
  let bookings: Repository<Booking>;
  let payments: Repository<Payment>;
  let customers: Repository<Customer>;
  const suffix = E2eHarness.createUniqueSuffix();
  const roomIds: string[] = [];
  const roomTypeIds: string[] = [];
  const bookingIds: string[] = [];
  const paymentIds: string[] = [];
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

    const customer = await customers.save(
      customers.create({
        fullName: 'VNPay callback customer',
        email: 'vnpay-callback-' + suffix + '@example.com',
        phone: '09' + String(Date.now()).slice(-8),
        passwordHash: null,
        tokenVersion: 0,
        status: 'ACTIVE',
      }),
    );
    customerIds.push(customer.id);

    harness.registerCleanup(async () => {
      if (bookingIds.length > 0)
        await bookings.update([...new Set(bookingIds)], {
          acceptedPaymentId: null,
        });
      if (paymentIds.length > 0)
        await payments.delete([...new Set(paymentIds)]);
      if (bookingIds.length > 0)
        await bookings.delete([...new Set(bookingIds)]);
      if (roomIds.length > 0) await rooms.delete([...new Set(roomIds)]);
      if (roomTypeIds.length > 0)
        await roomTypes.delete([...new Set(roomTypeIds)]);
      if (customerIds.length > 0)
        await customers.delete([...new Set(customerIds)]);
    });
  });

  afterAll(async () => {
    try {
      await harness?.cleanup();
    } finally {
      await app?.close();
    }
  });

  it('processes a verified success, rejects tampered amount, and makes repeated IPN idempotent', async () => {
    const booking = await createBooking(
      BookingStatus.PENDING_PAYMENT,
      BookingPaymentStatus.UNPAID,
    );
    const payment = await createPayment(
      booking.id,
      'normal-' + suffix,
      PaymentStatus.PENDING,
      null,
    );
    const valid = callback(
      payment.gatewayReference as string,
      '10000',
      '00',
      '00',
      'normal-tx-' + suffix,
    );
    const invalidAmount: Record<string, string> = {
      ...valid,
      vnp_Amount: '1',
    };
    invalidAmount.vnp_SecureHash = createVnPaySignature(
      invalidAmount,
      secret(),
    );
    await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/ipn')
      .query(invalidAmount)
      .expect(200)
      .expect({ RspCode: '97', Message: 'Invalid signature' });
    expect(await payments.findOneByOrFail({ id: payment.id })).toMatchObject({
      status: PaymentStatus.PENDING,
    });

    await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/ipn')
      .query(valid)
      .expect(200)
      .expect({ RspCode: '00', Message: 'Confirm Success' });
    expect(await payments.findOneByOrFail({ id: payment.id })).toMatchObject({
      status: PaymentStatus.SUCCESS,
      gatewayTransactionId: 'normal-tx-' + suffix,
    });
    expect(await bookings.findOneByOrFail({ id: booking.id })).toMatchObject({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const repeated = await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/ipn')
      .query(valid)
      .expect(200);
    expect(repeated.body as VnPayResponse).toEqual({
      RspCode: '02',
      Message: 'Order already confirmed',
    });
  });

  it('rejects reuse of a gateway transaction id by a payment for another booking', async () => {
    const sharedTransactionId = 'shared-tx-' + suffix;
    const firstBooking = await createBooking(
      BookingStatus.CONFIRMED,
      BookingPaymentStatus.PAID,
    );
    const firstPayment = await createPayment(
      firstBooking.id,
      'shared-first-' + suffix,
      PaymentStatus.SUCCESS,
      '00',
    );
    await payments.update(firstPayment.id, {
      gatewayTransactionId: sharedTransactionId,
      paidAt: new Date(),
    });

    const secondBooking = await createBooking(
      BookingStatus.PENDING_PAYMENT,
      BookingPaymentStatus.UNPAID,
    );
    const secondPayment = await createPayment(
      secondBooking.id,
      'shared-second-' + suffix,
      PaymentStatus.PENDING,
      null,
    );

    const response = await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/ipn')
      .query(
        callback(
          secondPayment.gatewayReference as string,
          '10000',
          '00',
          '00',
          sharedTransactionId,
        ),
      )
      .expect(200);

    expect(response.body as VnPayResponse).toEqual({
      RspCode: '99',
      Message: 'Unknown error',
    });
    expect(
      await payments.countBy({ gatewayTransactionId: sharedTransactionId }),
    ).toBe(1);
    expect(
      await payments.findOneByOrFail({ id: secondPayment.id }),
    ).toMatchObject({
      status: PaymentStatus.PENDING,
      gatewayTransactionId: null,
      gatewayResponseCode: null,
      gatewayTransactionStatus: null,
    });
    expect(
      await bookings.findOneByOrFail({ id: secondBooking.id }),
    ).toMatchObject({
      status: BookingStatus.PENDING_PAYMENT,
      paymentStatus: BookingPaymentStatus.UNPAID,
    });
  });

  it('marks a late success after cancelled Booking as REQUIRES_REVIEW', async () => {
    const booking = await createBooking(
      BookingStatus.CANCELLED,
      BookingPaymentStatus.UNPAID,
    );
    const payment = await createPayment(
      booking.id,
      'cancelled-' + suffix,
      PaymentStatus.FAILED,
      'EXPIRED',
    );
    const response = await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/ipn')
      .query(
        callback(
          payment.gatewayReference as string,
          '10000',
          '00',
          '00',
          'cancelled-tx-' + suffix,
        ),
      )
      .expect(200);
    expect(response.body as VnPayResponse).toEqual({
      RspCode: '00',
      Message: 'Confirm Success',
    });
    expect(await payments.findOneByOrFail({ id: payment.id })).toMatchObject({
      status: PaymentStatus.REQUIRES_REVIEW,
      reviewReason: PaymentReviewReason.BOOKING_CANCELLED,
      reviewCanonicalPaymentId: null,
      gatewayTransactionId: 'cancelled-tx-' + suffix,
    });
  });

  it('does not create a second SUCCESS after another attempt already succeeded', async () => {
    const booking = await createBooking(
      BookingStatus.CONFIRMED,
      BookingPaymentStatus.PAID,
    );
    const first = await createPayment(
      booking.id,
      'risk-a-' + suffix,
      PaymentStatus.FAILED,
      'EXPIRED',
    );
    const second = await createPayment(
      booking.id,
      'risk-b-' + suffix,
      PaymentStatus.SUCCESS,
      '00',
    );
    await payments.update(second.id, {
      gatewayTransactionId: 'success-b-' + suffix,
      paidAt: new Date(),
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/ipn')
      .query(
        callback(
          first.gatewayReference as string,
          '10000',
          '00',
          '00',
          'late-a-' + suffix,
        ),
      )
      .expect(200);
    expect(response.body as VnPayResponse).toEqual({
      RspCode: '00',
      Message: 'Confirm Success',
    });
    const refreshedFirst = await payments.findOneByOrFail({ id: first.id });
    expect(refreshedFirst).toMatchObject({
      status: PaymentStatus.REQUIRES_REVIEW,
      reviewReason: PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT,
      reviewCanonicalPaymentId: second.id,
    });
    expect(
      await payments.countBy({
        bookingId: booking.id,
        status: PaymentStatus.SUCCESS,
      }),
    ).toBe(1);
  });

  async function createBooking(
    status: BookingStatus,
    paymentStatus: BookingPaymentStatus,
  ): Promise<Booking> {
    const room = await createRoom();
    const customer = await customers.findOneByOrFail({ id: customerIds[0] });
    const booking = await bookings.save(
      bookings.create({
        bookingCode:
          'VP-' +
          suffix.replace(/[^A-Za-z0-9]/g, '').slice(-24) +
          '-' +
          sequence,
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
        status,
        paymentStatus,
        paymentExpiresAt: null,
        customerNote: null,
        cancelledAt: status === BookingStatus.CANCELLED ? new Date() : null,
        cancellationReason:
          status === BookingStatus.CANCELLED ? 'cancelled fixture' : null,
      }),
    );
    bookingIds.push(booking.id);
    return booking;
  }

  async function createPayment(
    bookingId: string,
    reference: string,
    status: PaymentStatus,
    responseCode: string | null,
  ): Promise<Payment> {
    const payment = await payments.save(
      payments.create({
        bookingId,
        amount: '100.00',
        currency: 'VND',
        method: PaymentMethod.VNPAY,
        status,
        gatewayName: 'VNPAY',
        gatewayReference: reference,
        gatewayTransactionId: null,
        gatewayPaymentUrl: null,
        gatewayResponseCode: responseCode,
        gatewayTransactionStatus: responseCode,
        gatewayTransactionDate: null,
        idempotencyKey: 'key-' + reference,
        createdByUserId: null,
        paidAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    paymentIds.push(payment.id);
    return payment;
  }

  async function createRoom(): Promise<Room> {
    const roomType = await roomTypes.save(
      roomTypes.create({
        name: 'VNPay ' + suffix + '-' + sequence,
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
        roomNumber: 'VP-' + suffix + '-' + sequence,
        name: 'VNPay room',
        description: null,
        status: RoomStatus.READY,
      }),
    );
    roomIds.push(room.id);
    return room;
  }

  function callback(
    reference: string,
    amount: string,
    responseCode: string,
    transactionStatus: string,
    transactionId: string,
  ): Record<string, string> {
    const parameters = {
      vnp_Amount: amount,
      vnp_OrderInfo: 'VNPay callback workflow',
      vnp_PayDate: formatVnPayDate(new Date()),
      vnp_ResponseCode: responseCode,
      vnp_TmnCode: 'TEST0001',
      vnp_TransactionNo: transactionId,
      vnp_TransactionStatus: transactionStatus,
      vnp_TxnRef: reference,
    };
    return {
      ...parameters,
      vnp_SecureHash: createVnPaySignature(parameters, secret()),
    };
  }

  function secret(): string {
    return 'test-vnpay-secret-at-least-16-characters';
  }
});
