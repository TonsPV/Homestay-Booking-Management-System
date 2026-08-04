import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/http';
import migrationDataSource from '../src/database/data-source';
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
import { AccessTokenService } from '../src/module/auth/access-token.service';
import {
  Payment,
  PaymentMethod,
  PaymentStatus,
} from '../src/module/payment/schema/payment.entity';
import {
  VnPayGatewayService,
  type VnPayGatewayOperationResult,
} from '../src/module/payment/vnpay-gateway.service';
import { Room, RoomStatus } from '../src/module/room/schema/room.entity';
import { RoomType } from '../src/module/room-type/schema/room-type.entity';
import { User } from '../src/module/user/schema/user.entity';
import { E2eHarness } from './e2e-harness';

interface PaymentResponseBody {
  data: {
    id: string;
    status: PaymentStatus;
    refundReason?: string | null;
  };
}

describe('Payment refund/reconciliation workflow (e2e)', () => {
  let app: INestApplication<App>;
  let harness: E2eHarness | undefined;
  let dataSource: DataSource;
  let customers: Repository<Customer>;
  let users: Repository<User>;
  let roomTypes: Repository<RoomType>;
  let rooms: Repository<Room>;
  let bookings: Repository<Booking>;
  let payments: Repository<Payment>;
  let calendars: Repository<RoomCalendar>;
  let accessTokenService: AccessTokenService;
  let adminToken: string;
  let staffToken: string;
  const suffix = E2eHarness.createUniqueSuffix();
  const customerIds: string[] = [];
  const userIds: string[] = [];
  const roomTypeIds: string[] = [];
  const roomIds: string[] = [];
  const bookingIds: string[] = [];
  const paymentIds: string[] = [];
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
    customers = dataSource.getRepository(Customer);
    users = dataSource.getRepository(User);
    roomTypes = dataSource.getRepository(RoomType);
    rooms = dataSource.getRepository(Room);
    bookings = dataSource.getRepository(Booking);
    payments = dataSource.getRepository(Payment);
    calendars = dataSource.getRepository(RoomCalendar);
    accessTokenService = app.get(AccessTokenService);

    const customer = await customers.save(
      customers.create({
        fullName: 'Refund workflow customer',
        email: `refund-${suffix}@example.com`,
        phone: '09' + String(Date.now()).slice(-8),
        passwordHash: null,
        tokenVersion: 0,
        status: 'ACTIVE',
      }),
    );
    customerIds.push(customer.id);

    const admin = await users.save(
      users.create({
        fullName: 'Refund workflow admin',
        email: `refund-admin-${suffix}@example.com`,
        phone: null,
        passwordHash: 'fixture-password-hash',
        tokenVersion: 0,
        role: 'ADMIN',
        status: 'ACTIVE',
      }),
    );
    const staff = await users.save(
      users.create({
        fullName: 'Refund workflow staff',
        email: `refund-staff-${suffix}@example.com`,
        phone: null,
        passwordHash: 'fixture-password-hash',
        tokenVersion: 0,
        role: 'STAFF',
        status: 'ACTIVE',
      }),
    );
    userIds.push(admin.id, staff.id);
    adminToken = accessTokenService.sign({
      actorType: 'user',
      userId: admin.id,
      role: 'ADMIN',
      tokenVersion: admin.tokenVersion,
    });
    staffToken = accessTokenService.sign({
      actorType: 'user',
      userId: staff.id,
      role: 'STAFF',
      tokenVersion: staff.tokenVersion,
    });

    harness.registerCleanup(async () => {
      if (paymentIds.length > 0)
        await payments.delete([...new Set(paymentIds)]);
      if (bookingIds.length > 0)
        await calendars.delete({ bookingId: bookingIds[0] });
      for (const bookingId of [...new Set(bookingIds)].slice(1)) {
        await calendars.delete({ bookingId });
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

  it('enforces ADMIN-only manual refund and atomically releases the calendar', async () => {
    const { booking, payment } = await createPaidPayment(PaymentMethod.CASH);
    await calendars.save(
      calendars.create({
        roomId: booking.roomId,
        bookingId: booking.id,
        stayDate: booking.checkInDate,
        status: RoomCalendarStatus.RESERVED,
        reason: null,
      }),
    );

    await request(app.getHttpServer())
      .post(`/api/v1/management/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ reason: 'Staff must not refund.' })
      .expect(403);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/management/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Guest cancelled.' })
      .expect(200);

    const responseBody = response.body as PaymentResponseBody;
    expect(responseBody.data).toMatchObject({
      id: payment.id,
      status: PaymentStatus.REFUNDED,
      refundReason: 'Guest cancelled.',
    });
    expect(await calendars.countBy({ bookingId: booking.id })).toBe(0);
    expect(await bookings.findOneByOrFail({ id: booking.id })).toMatchObject({
      status: BookingStatus.CANCELLED,
      paymentStatus: BookingPaymentStatus.REFUNDED,
    });

    await request(app.getHttpServer())
      .post(`/api/v1/management/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Idempotent replay.' })
      .expect(200);
  });

  it('keeps a timed-out VNPay refund pending and reconciles without a second refund mutation', async () => {
    const { booking, payment } = await createPaidPayment(PaymentMethod.VNPAY);
    const gateway = app.get(VnPayGatewayService);
    const refundSpy = jest
      .spyOn(gateway, 'refundFull')
      .mockRejectedValueOnce(new Error('fixture provider timeout'));
    const querySpy = jest
      .spyOn(gateway, 'queryTransaction')
      .mockResolvedValueOnce(
        operationResult({
          transactionType: '01',
          message: 'Still processing.',
        }),
      );

    try {
      await request(app.getHttpServer())
        .post(`/api/v1/management/payments/${payment.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `refund-timeout-${suffix}`)
        .send({ reason: 'Timeout path.' })
        .expect(503);

      expect(await payments.findOneByOrFail({ id: payment.id })).toMatchObject({
        status: PaymentStatus.REFUND_PENDING,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/management/payments/${payment.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `refund-timeout-${suffix}`)
        .send({ reason: 'Safe replay.' })
        .expect(200)
        .expect((response) => {
          const body = response.body as PaymentResponseBody;
          expect(body.data.status).toBe(PaymentStatus.REFUND_PENDING);
        });

      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(querySpy).toHaveBeenCalledTimes(1);

      querySpy.mockResolvedValueOnce(
        operationResult({
          transactionType: '02',
          message: 'Refund completed.',
        }),
      );
      const reconcile = await request(app.getHttpServer())
        .post(`/api/v1/management/payments/${payment.id}/reconcile-refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const reconcileBody = reconcile.body as PaymentResponseBody;
      expect(reconcileBody.data.status).toBe(PaymentStatus.REFUNDED);
      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(await bookings.findOneByOrFail({ id: booking.id })).toMatchObject({
        status: BookingStatus.CANCELLED,
        paymentStatus: BookingPaymentStatus.REFUNDED,
      });
    } finally {
      refundSpy.mockRestore();
      querySpy.mockRestore();
    }
  });

  it('requires an idempotency key for VNPay and restores SUCCESS after explicit rejection', async () => {
    const { payment } = await createPaidPayment(PaymentMethod.VNPAY);
    await request(app.getHttpServer())
      .post(`/api/v1/management/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Missing key.' })
      .expect(400);

    const gateway = app.get(VnPayGatewayService);
    const refundSpy = jest.spyOn(gateway, 'refundFull').mockResolvedValueOnce({
      ...operationResult({ transactionType: '02', message: 'Rejected.' }),
      isSuccess: false,
      responseCode: '91',
      transactionStatus: '91',
      transactionId: null,
      amount: null,
    });
    const key = `refund-reject-${suffix}`;
    try {
      await request(app.getHttpServer())
        .post(`/api/v1/management/payments/${payment.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', key)
        .send({ reason: 'Provider rejected.' })
        .expect(409);
      expect(await payments.findOneByOrFail({ id: payment.id })).toMatchObject({
        status: PaymentStatus.SUCCESS,
        refundResponseCode: '91',
      });
      await request(app.getHttpServer())
        .post(`/api/v1/management/payments/${payment.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', key)
        .send({ reason: 'Rejected replay.' })
        .expect(409);
      expect(refundSpy).toHaveBeenCalledTimes(1);
    } finally {
      refundSpy.mockRestore();
    }
  });

  it('restores the exact previous status when reconciliation receives an explicit reject', async () => {
    const { payment } = await createPaidPayment(PaymentMethod.VNPAY);
    const refundKey = `reconcile-reject-${suffix}`;
    await payments.update(payment.id, {
      status: PaymentStatus.REFUND_PENDING,
      refundIdempotencyKey: refundKey,
      refundRequestId: `R-${suffix}`.slice(0, 32),
      refundPreviousStatus: PaymentStatus.SUCCESS,
      refundReason: 'Reconciliation reject fixture.',
      refundResponseCode: null,
      refundTransactionStatus: null,
      refundGatewayTransactionId: null,
    });

    const gateway = app.get(VnPayGatewayService);
    const querySpy = jest
      .spyOn(gateway, 'queryTransaction')
      .mockResolvedValueOnce(
        operationResult({
          isSuccess: false,
          responseCode: '91',
          transactionStatus: '91',
          transactionId: null,
          amount: null,
          message: 'Refund rejected by provider.',
        }),
      );

    try {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/management/payments/${payment.id}/reconcile-refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const body = response.body as PaymentResponseBody;

      expect(body.data.status).toBe(PaymentStatus.SUCCESS);
      expect(await payments.findOneByOrFail({ id: payment.id })).toMatchObject({
        status: PaymentStatus.SUCCESS,
        refundResponseCode: '91',
        refundTransactionStatus: '91',
      });
      expect(querySpy).toHaveBeenCalledTimes(1);
    } finally {
      querySpy.mockRestore();
    }
  });

  async function createPaidPayment(
    method: PaymentMethod,
  ): Promise<{ booking: Booking; payment: Payment }> {
    const customer = await customers.findOneByOrFail({ id: customerIds[0] });
    const roomType = await roomTypes.save(
      roomTypes.create({
        name: `Refund room type ${suffix}-${sequence}`,
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
        roomNumber: `RF-${suffix}-${sequence}`,
        name: 'Refund workflow room',
        description: null,
        status: RoomStatus.READY,
      }),
    );
    roomIds.push(room.id);
    const index = sequence++;
    const booking = await bookings.save(
      bookings.create({
        bookingCode: `RF-${suffix.replace(/[^A-Za-z0-9]/g, '').slice(-22)}-${index}`,
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
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.PAID,
        paymentExpiresAt: null,
        customerNote: null,
        cancelledAt: null,
        cancellationReason: null,
      }),
    );
    bookingIds.push(booking.id);
    const payment = await payments.save(
      payments.create({
        bookingId: booking.id,
        amount: '100.00',
        currency: 'VND',
        method,
        status: PaymentStatus.SUCCESS,
        gatewayName: method === PaymentMethod.VNPAY ? 'VNPAY' : null,
        gatewayReference:
          method === PaymentMethod.VNPAY
            ? `refund-ref-${suffix}-${index}`
            : null,
        gatewayTransactionId:
          method === PaymentMethod.VNPAY
            ? `refund-tx-${suffix}-${index}`
            : null,
        gatewayPaymentUrl: null,
        gatewayResponseCode: method === PaymentMethod.VNPAY ? '00' : null,
        gatewayTransactionStatus: method === PaymentMethod.VNPAY ? '00' : null,
        gatewayTransactionDate:
          method === PaymentMethod.VNPAY ? '20380101070000' : null,
        idempotencyKey: null,
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
        paidAt: new Date(),
        refundedAt: null,
        refundRequestedAt: null,
        refundLastQueriedAt: null,
        expiresAt: null,
      }),
    );
    paymentIds.push(payment.id);
    return { booking, payment };
  }

  function operationResult(
    overrides: Partial<VnPayGatewayOperationResult>,
  ): VnPayGatewayOperationResult {
    return {
      isVerified: true,
      isSuccess: true,
      responseCode: '00',
      transactionStatus: '00',
      transactionId: `refund-gateway-${suffix}`,
      transactionType: '02',
      amount: '100',
      responseId: 'REFUND-FIXTURE',
      message: 'Refund result.',
      ...overrides,
    };
  }
});
