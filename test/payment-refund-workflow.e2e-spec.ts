import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, In, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/http';
import migrationDataSource from '../src/database/data-source';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
  AuditLog,
} from '../src/module/audit/schema/audit-log.entity';
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
  PaymentReviewReason,
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
    reviewReason?: PaymentReviewReason | null;
    reviewCanonicalPaymentId?: string | null;
    refundRequestId?: string | null;
    refundReason?: string | null;
  };
}

interface DuplicateChargeFixture {
  booking: Booking;
  canonicalPayment: Payment;
  duplicatePayment: Payment;
}

interface CalendarSnapshot {
  id: string;
  roomId: string;
  bookingId: string | null;
  stayDate: string;
  status: RoomCalendarStatus;
  reason: string | null;
}

describe('Payment refund/reconciliation workflow (e2e)', () => {
  let app: INestApplication<App>;
  let harness: E2eHarness | undefined;
  let dataSource: DataSource;
  let auditLogs: Repository<AuditLog>;
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
    auditLogs = dataSource.getRepository(AuditLog);
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
      const ownedPaymentIds = [...new Set(paymentIds)];
      const ownedBookingIds = [...new Set(bookingIds)];

      if (ownedPaymentIds.length > 0 || ownedBookingIds.length > 0) {
        await auditLogs.delete([
          ...(ownedPaymentIds.length === 0
            ? []
            : [
                {
                  entityType: AuditEntityType.PAYMENT,
                  entityId: In(ownedPaymentIds),
                },
              ]),
          ...(ownedBookingIds.length === 0
            ? []
            : [
                {
                  entityType: AuditEntityType.BOOKING,
                  entityId: In(ownedBookingIds),
                },
              ]),
        ]);
      }

      if (ownedPaymentIds.length > 0) await payments.delete(ownedPaymentIds);
      if (ownedBookingIds.length > 0) {
        await calendars.delete({ bookingId: In(ownedBookingIds) });
        await bookings.delete(ownedBookingIds);
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

  it('resolves only the duplicate VNPay charge as ADMIN and preserves the paid stay', async () => {
    const fixture = await createDuplicateCharge();
    const calendarBefore = await takeCalendarSnapshot(fixture.booking.id);
    const gateway = app.get(VnPayGatewayService);
    const refundSpy = jest.spyOn(gateway, 'refundFull').mockResolvedValueOnce(
      operationResult({
        transactionId: `duplicate-refund-${suffix}`,
        message: 'Duplicate charge refunded.',
      }),
    );
    const requestId = `duplicate-success-${suffix}`;

    try {
      await resolveDuplicateCharge(
        fixture.duplicatePayment.id,
        `duplicate-staff-${suffix}`,
        staffToken,
      ).expect(403);

      await resolveDuplicateCharge(
        fixture.duplicatePayment.id,
        undefined,
        adminToken,
      ).expect(400);

      await resolveDuplicateCharge(
        fixture.canonicalPayment.id,
        `canonical-refund-${suffix}`,
        adminToken,
      ).expect(409);
      expect(refundSpy).not.toHaveBeenCalled();

      const response = await resolveDuplicateCharge(
        fixture.duplicatePayment.id,
        `duplicate-success-${suffix}`,
        adminToken,
        requestId,
      ).expect(200);
      const body = response.body as PaymentResponseBody;

      expect(body.data).toMatchObject({
        id: fixture.duplicatePayment.id,
        status: PaymentStatus.REFUNDED,
        reviewReason: PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT,
        reviewCanonicalPaymentId: fixture.canonicalPayment.id,
      });
      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(refundSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: fixture.duplicatePayment.amount,
          transactionReference: fixture.duplicatePayment.gatewayReference,
          transactionId: fixture.duplicatePayment.gatewayTransactionId,
          transactionDate: fixture.duplicatePayment.gatewayTransactionDate,
        }),
      );

      const canonicalPayment = await payments.findOneByOrFail({
        id: fixture.canonicalPayment.id,
      });
      const duplicatePayment = await payments.findOneByOrFail({
        id: fixture.duplicatePayment.id,
      });
      expect(canonicalPayment.status).toBe(PaymentStatus.SUCCESS);
      expect(duplicatePayment).toMatchObject({
        status: PaymentStatus.REFUNDED,
        reviewReason: PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT,
        reviewCanonicalPaymentId: canonicalPayment.id,
      });
      expect(duplicatePayment.refundRequestId).toEqual(expect.any(String));
      await expectBookingAndCalendarUnchanged(fixture, calendarBefore);

      const refundAudits = await auditLogs.find({
        where: {
          entityType: AuditEntityType.PAYMENT,
          entityId: duplicatePayment.id,
        },
      });
      const requestedAudits = refundAudits.filter(
        (audit) => audit.action === AuditAction.REFUND_REQUESTED,
      );
      const completedAudits = refundAudits.filter(
        (audit) => audit.action === AuditAction.REFUND_COMPLETED,
      );
      expect(requestedAudits).toHaveLength(1);
      expect(completedAudits).toHaveLength(1);

      for (const audit of [requestedAudits[0], completedAudits[0]]) {
        expect(audit).toMatchObject({
          actorType: AuditActorType.USER,
          actorId: userIds[0],
          entityType: AuditEntityType.PAYMENT,
          entityId: duplicatePayment.id,
          requestId,
          metadata: {
            bookingId: fixture.booking.id,
            canonicalPaymentId: canonicalPayment.id,
            duplicatePaymentId: duplicatePayment.id,
            reason: PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT,
            refundRequestId: duplicatePayment.refundRequestId,
          },
        });
        expect(audit.metadata).not.toHaveProperty('gatewayReference');
        expect(audit.metadata).not.toHaveProperty('gatewayTransactionId');
      }
    } finally {
      refundSpy.mockRestore();
    }
  });

  it('serializes concurrent duplicate resolution into one logical and outbound refund', async () => {
    const fixture = await createDuplicateCharge();
    const calendarBefore = await takeCalendarSnapshot(fixture.booking.id);
    const gateway = app.get(VnPayGatewayService);
    let signalRefundStarted: () => void = () => undefined;
    let releaseRefund: () => void = () => undefined;
    const refundStarted = new Promise<void>((resolve) => {
      signalRefundStarted = resolve;
    });
    const refundRelease = new Promise<void>((resolve) => {
      releaseRefund = resolve;
    });
    const refundSpy = jest
      .spyOn(gateway, 'refundFull')
      .mockImplementationOnce(async () => {
        signalRefundStarted();
        await refundRelease;
        return operationResult({
          transactionId: `concurrent-refund-${suffix}`,
          message: 'Concurrent duplicate charge refunded.',
        });
      });
    const querySpy = jest
      .spyOn(gateway, 'queryTransaction')
      .mockResolvedValueOnce(
        operationResult({
          transactionId: fixture.duplicatePayment.gatewayTransactionId,
          transactionType: '01',
          message: 'Original collection is still visible.',
        }),
      );
    const idempotencyKey = `duplicate-concurrent-${suffix}`;
    let released = false;
    let firstPromise: Promise<request.Response> | undefined;

    try {
      firstPromise = resolveDuplicateCharge(
        fixture.duplicatePayment.id,
        idempotencyKey,
        adminToken,
        `duplicate-concurrent-first-${suffix}`,
      )
        .expect(200)
        .then((response) => response);

      await refundStarted;
      expect(
        await payments.findOneByOrFail({ id: fixture.duplicatePayment.id }),
      ).toMatchObject({
        status: PaymentStatus.REFUND_PENDING,
        refundIdempotencyKey: idempotencyKey,
        refundPreviousStatus: PaymentStatus.REQUIRES_REVIEW,
      });

      const secondResponse = await resolveDuplicateCharge(
        fixture.duplicatePayment.id,
        idempotencyKey,
        adminToken,
        `duplicate-concurrent-second-${suffix}`,
      ).expect(200);
      expect((secondResponse.body as PaymentResponseBody).data.status).toBe(
        PaymentStatus.REFUND_PENDING,
      );

      await resolveDuplicateCharge(
        fixture.duplicatePayment.id,
        `${idempotencyKey}-different`,
        adminToken,
        `duplicate-concurrent-conflict-${suffix}`,
      ).expect(409);

      releaseRefund();
      released = true;
      const firstResponse = await firstPromise;
      expect((firstResponse.body as PaymentResponseBody).data.status).toBe(
        PaymentStatus.REFUNDED,
      );

      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(
        await auditLogs.countBy({
          action: AuditAction.REFUND_REQUESTED,
          entityType: AuditEntityType.PAYMENT,
          entityId: fixture.duplicatePayment.id,
        }),
      ).toBe(1);
      expect(
        await auditLogs.countBy({
          action: AuditAction.REFUND_COMPLETED,
          entityType: AuditEntityType.PAYMENT,
          entityId: fixture.duplicatePayment.id,
        }),
      ).toBe(1);
      expect(
        await payments.findOneByOrFail({ id: fixture.canonicalPayment.id }),
      ).toMatchObject({ status: PaymentStatus.SUCCESS });
      expect(
        await payments.findOneByOrFail({ id: fixture.duplicatePayment.id }),
      ).toMatchObject({ status: PaymentStatus.REFUNDED });
      await expectBookingAndCalendarUnchanged(fixture, calendarBefore);
    } finally {
      if (!released) releaseRefund();
      await firstPromise?.catch(() => undefined);
      refundSpy.mockRestore();
      querySpy.mockRestore();
    }
  });

  it('rejects a different review reason, missing canonical SUCCESS, and missing gateway identity', async () => {
    const wrongReason = await createDuplicateCharge({
      reviewReason: PaymentReviewReason.BOOKING_CANCELLED,
    });
    const wrongReasonCalendar = await takeCalendarSnapshot(
      wrongReason.booking.id,
    );
    const missingCanonical = await createDuplicateCharge({
      canonicalSuccessful: false,
    });
    const missingCanonicalCalendar = await takeCalendarSnapshot(
      missingCanonical.booking.id,
    );
    const missingGateway = await createDuplicateCharge();
    await payments.update(missingGateway.duplicatePayment.id, {
      gatewayTransactionId: null,
    });
    missingGateway.duplicatePayment.gatewayTransactionId = null;
    const missingGatewayCalendar = await takeCalendarSnapshot(
      missingGateway.booking.id,
    );
    const gateway = app.get(VnPayGatewayService);
    const refundSpy = jest
      .spyOn(gateway, 'refundFull')
      .mockRejectedValue(new Error('Ineligible payment reached the gateway.'));

    try {
      await resolveDuplicateCharge(
        wrongReason.duplicatePayment.id,
        `duplicate-wrong-reason-${suffix}`,
        adminToken,
      ).expect(409);
      await resolveDuplicateCharge(
        missingCanonical.duplicatePayment.id,
        `duplicate-missing-canonical-${suffix}`,
        adminToken,
      ).expect(409);
      await resolveDuplicateCharge(
        missingGateway.duplicatePayment.id,
        `duplicate-missing-gateway-${suffix}`,
        adminToken,
      ).expect(409);

      expect(refundSpy).not.toHaveBeenCalled();
      expect(
        await payments.findOneByOrFail({ id: wrongReason.duplicatePayment.id }),
      ).toMatchObject({ status: PaymentStatus.REQUIRES_REVIEW });
      expect(
        await payments.findOneByOrFail({
          id: missingCanonical.duplicatePayment.id,
        }),
      ).toMatchObject({ status: PaymentStatus.REQUIRES_REVIEW });
      expect(
        await payments.findOneByOrFail({
          id: missingGateway.duplicatePayment.id,
        }),
      ).toMatchObject({
        status: PaymentStatus.REQUIRES_REVIEW,
        refundIdempotencyKey: null,
        refundRequestId: null,
      });
      await expectBookingAndCalendarUnchanged(wrongReason, wrongReasonCalendar);
      await expectBookingAndCalendarUnchanged(
        missingCanonical,
        missingCanonicalCalendar,
      );
      await expectBookingAndCalendarUnchanged(
        missingGateway,
        missingGatewayCalendar,
      );
    } finally {
      refundSpy.mockRestore();
    }
  });

  it('reconciles a pending duplicate replay and returns an already refunded duplicate without another mutation', async () => {
    const pending = await createDuplicateCharge();
    const pendingCalendar = await takeCalendarSnapshot(pending.booking.id);
    const pendingKey = `duplicate-pending-${suffix}`;
    await payments.update(pending.duplicatePayment.id, {
      status: PaymentStatus.REFUND_PENDING,
      refundIdempotencyKey: pendingKey,
      refundRequestId: createFixtureRefundRequestId('P'),
      refundPreviousStatus: PaymentStatus.REQUIRES_REVIEW,
      refundReason: 'Refund duplicate VNPay charge.',
      refundedByUserId: userIds[0],
      refundRequestedAt: new Date(),
    });

    const refunded = await createDuplicateCharge();
    const refundedCalendar = await takeCalendarSnapshot(refunded.booking.id);
    const refundedKey = `duplicate-refunded-${suffix}`;
    await payments.update(refunded.duplicatePayment.id, {
      status: PaymentStatus.REFUNDED,
      refundIdempotencyKey: refundedKey,
      refundRequestId: createFixtureRefundRequestId('D'),
      refundPreviousStatus: PaymentStatus.REQUIRES_REVIEW,
      refundGatewayTransactionId: `already-refunded-${suffix}`,
      refundResponseCode: '00',
      refundTransactionStatus: '00',
      refundMessage: 'Duplicate charge already refunded.',
      refundReason: 'Refund duplicate VNPay charge.',
      refundedByUserId: userIds[0],
      refundRequestedAt: new Date(),
      refundedAt: new Date(),
    });

    const gateway = app.get(VnPayGatewayService);
    const refundSpy = jest
      .spyOn(gateway, 'refundFull')
      .mockRejectedValue(new Error('Replay sent another refund mutation.'));
    const querySpy = jest
      .spyOn(gateway, 'queryTransaction')
      .mockResolvedValueOnce(
        operationResult({
          transactionId: pending.duplicatePayment.gatewayTransactionId,
          transactionType: '01',
          message: 'Refund is not confirmed yet.',
        }),
      );

    try {
      const pendingResponse = await resolveDuplicateCharge(
        pending.duplicatePayment.id,
        pendingKey,
        adminToken,
      ).expect(200);
      expect((pendingResponse.body as PaymentResponseBody).data.status).toBe(
        PaymentStatus.REFUND_PENDING,
      );
      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(refundSpy).not.toHaveBeenCalled();

      const refundedResponse = await resolveDuplicateCharge(
        refunded.duplicatePayment.id,
        refundedKey,
        adminToken,
      ).expect(200);
      expect((refundedResponse.body as PaymentResponseBody).data.status).toBe(
        PaymentStatus.REFUNDED,
      );
      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(refundSpy).not.toHaveBeenCalled();
      await expectBookingAndCalendarUnchanged(pending, pendingCalendar);
      await expectBookingAndCalendarUnchanged(refunded, refundedCalendar);
    } finally {
      refundSpy.mockRestore();
      querySpy.mockRestore();
    }
  });

  it('keeps duplicate resolution REFUND_PENDING after a gateway timeout', async () => {
    const fixture = await createDuplicateCharge();
    const calendarBefore = await takeCalendarSnapshot(fixture.booking.id);
    const gateway = app.get(VnPayGatewayService);
    const refundSpy = jest
      .spyOn(gateway, 'refundFull')
      .mockRejectedValueOnce(new Error('duplicate refund timeout'));

    try {
      await resolveDuplicateCharge(
        fixture.duplicatePayment.id,
        `duplicate-timeout-${suffix}`,
        adminToken,
        `duplicate-timeout-${suffix}`,
      ).expect(503);

      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(
        await payments.findOneByOrFail({ id: fixture.canonicalPayment.id }),
      ).toMatchObject({ status: PaymentStatus.SUCCESS });
      expect(
        await payments.findOneByOrFail({ id: fixture.duplicatePayment.id }),
      ).toMatchObject({
        status: PaymentStatus.REFUND_PENDING,
        refundPreviousStatus: PaymentStatus.REQUIRES_REVIEW,
      });
      expect(
        await auditLogs.countBy({
          action: AuditAction.REFUND_COMPLETED,
          entityType: AuditEntityType.PAYMENT,
          entityId: fixture.duplicatePayment.id,
        }),
      ).toBe(0);
      await expectBookingAndCalendarUnchanged(fixture, calendarBefore);
    } finally {
      refundSpy.mockRestore();
    }
  });

  it('does not trust or persist an unverified duplicate refund result', async () => {
    const fixture = await createDuplicateCharge();
    const calendarBefore = await takeCalendarSnapshot(fixture.booking.id);
    const gateway = app.get(VnPayGatewayService);
    const refundSpy = jest.spyOn(gateway, 'refundFull').mockResolvedValueOnce({
      ...operationResult({ message: 'Unverified duplicate refund result.' }),
      isVerified: false,
      isSuccess: false,
      responseCode: '00',
      transactionStatus: '00',
      transactionId: `unverified-refund-${suffix}`,
    });

    try {
      await resolveDuplicateCharge(
        fixture.duplicatePayment.id,
        `duplicate-unverified-${suffix}`,
        adminToken,
        `duplicate-unverified-${suffix}`,
      ).expect(503);

      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(
        await payments.findOneByOrFail({ id: fixture.canonicalPayment.id }),
      ).toMatchObject({ status: PaymentStatus.SUCCESS });
      expect(
        await payments.findOneByOrFail({ id: fixture.duplicatePayment.id }),
      ).toMatchObject({
        status: PaymentStatus.REFUND_PENDING,
        refundGatewayTransactionId: null,
        refundResponseCode: null,
        refundTransactionStatus: null,
      });
      expect(
        await auditLogs.countBy({
          action: AuditAction.REFUND_COMPLETED,
          entityType: AuditEntityType.PAYMENT,
          entityId: fixture.duplicatePayment.id,
        }),
      ).toBe(0);
      await expectBookingAndCalendarUnchanged(fixture, calendarBefore);
    } finally {
      refundSpy.mockRestore();
    }
  });

  async function createDuplicateCharge(
    options: {
      reviewReason?: PaymentReviewReason;
      canonicalSuccessful?: boolean;
    } = {},
  ): Promise<DuplicateChargeFixture> {
    const { booking, payment } = await createPaidPayment(PaymentMethod.VNPAY);
    const reviewReason =
      options.reviewReason ?? PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT;
    let canonicalPayment = payment;

    if (options.canonicalSuccessful === false) {
      await payments.update(payment.id, {
        status: PaymentStatus.FAILED,
        paidAt: null,
      });
      canonicalPayment = await payments.findOneByOrFail({ id: payment.id });
    }

    await calendars.save([
      calendars.create({
        roomId: booking.roomId,
        bookingId: booking.id,
        stayDate: booking.checkInDate,
        status: RoomCalendarStatus.RESERVED,
        reason: null,
      }),
      calendars.create({
        roomId: booking.roomId,
        bookingId: booking.id,
        stayDate: '2038-01-02',
        status: RoomCalendarStatus.RESERVED,
        reason: null,
      }),
    ]);

    const index = sequence++;
    const duplicatePayment = await payments.save(
      payments.create({
        bookingId: booking.id,
        amount: canonicalPayment.amount,
        currency: 'VND',
        method: PaymentMethod.VNPAY,
        status: PaymentStatus.REQUIRES_REVIEW,
        reviewReason,
        reviewCanonicalPaymentId:
          reviewReason === PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT
            ? canonicalPayment.id
            : null,
        gatewayName: 'VNPAY',
        gatewayReference: `duplicate-ref-${suffix}-${index}`,
        gatewayTransactionId: `duplicate-tx-${suffix}-${index}`,
        gatewayPaymentUrl: null,
        gatewayResponseCode: '00',
        gatewayTransactionStatus: '00',
        gatewayTransactionDate: '20380101070000',
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
    paymentIds.push(duplicatePayment.id);

    return { booking, canonicalPayment, duplicatePayment };
  }

  function resolveDuplicateCharge(
    paymentId: string,
    idempotencyKey: string | undefined,
    token: string,
    requestId?: string,
  ): request.Test {
    const mutation = request(app.getHttpServer())
      .post(`/api/v1/management/payments/${paymentId}/resolve-duplicate-charge`)
      .set('Authorization', `Bearer ${token}`);

    if (idempotencyKey !== undefined) {
      mutation.set('Idempotency-Key', idempotencyKey);
    }
    if (requestId !== undefined) {
      mutation.set('X-Request-Id', requestId);
    }

    return mutation;
  }

  async function takeCalendarSnapshot(
    bookingId: string,
  ): Promise<CalendarSnapshot[]> {
    const rows = await calendars.find({
      where: { bookingId },
      order: { id: 'ASC' },
    });

    return rows.map((row) => ({
      id: row.id,
      roomId: row.roomId,
      bookingId: row.bookingId,
      stayDate: row.stayDate,
      status: row.status,
      reason: row.reason,
    }));
  }

  async function expectBookingAndCalendarUnchanged(
    fixture: DuplicateChargeFixture,
    calendarBefore: CalendarSnapshot[],
  ): Promise<void> {
    expect(
      await bookings.findOneByOrFail({ id: fixture.booking.id }),
    ).toMatchObject({
      status: fixture.booking.status,
      paymentStatus: fixture.booking.paymentStatus,
      paymentExpiresAt: fixture.booking.paymentExpiresAt,
      cancelledAt: fixture.booking.cancelledAt,
      cancellationReason: fixture.booking.cancellationReason,
    });
    expect(
      await payments.findOneByOrFail({ id: fixture.canonicalPayment.id }),
    ).toMatchObject({ status: fixture.canonicalPayment.status });
    expect(await takeCalendarSnapshot(fixture.booking.id)).toEqual(
      calendarBefore,
    );
  }

  function createFixtureRefundRequestId(prefix: string): string {
    return `${prefix}-${sequence++}-${suffix}`.slice(0, 32);
  }

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
