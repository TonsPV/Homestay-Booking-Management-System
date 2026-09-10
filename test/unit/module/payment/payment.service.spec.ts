import { ConflictException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type {
  DataSource,
  EntityManager,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';

import { TypeOrmTransactionRunner } from '../../../../src/common/database/typeorm-transaction.runner';
import type { TransactionContext } from '../../../../src/common/database/transaction';
import { ErrorCode } from '../../../../src/common/error-codes';
import type { AuditLogInput } from '../../../../src/module/audit/audit-log.service';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../../../../src/module/audit/domain/audit-log';
import { Booking } from '../../../../src/module/booking/schema/booking.entity';
import {
  BookingPaymentStatus,
  BookingStatus,
} from '../../../../src/module/booking/domain/booking-state';
import { RoomCalendar } from '../../../../src/module/booking/schema/room-calendar.entity';
import { TypeOrmRoomCalendarStore } from '../../../../src/module/booking/persistence/typeorm-room-calendar.store';
import {
  TypeOrmBookingLifecycleStore,
  TypeOrmBookingPaymentStateStore,
} from '../../../../src/module/booking/persistence/typeorm-booking-lifecycle.store';
import {
  PaymentService,
  type PaymentResponse,
} from '../../../../src/module/payment/payment.service';
import { PaymentCollectionService } from '../../../../src/module/payment/payment-collection.service';
import { PaymentQueryService } from '../../../../src/module/payment/payment-query.service';
import { PaymentManualService } from '../../../../src/module/payment/payment-manual.service';
import { PaymentRefundService } from '../../../../src/module/payment/payment-refund.service';
import { BookingPaymentLifecycleService } from '../../../../src/module/booking/booking-payment-lifecycle.service';
import { BookingTransitionPolicy } from '../../../../src/module/booking/domain/booking-transition.policy';
import { Payment } from '../../../../src/module/payment/schema/payment.entity';
import { PaymentRefund } from '../../../../src/module/payment/schema/payment-refund.entity';
import {
  PaymentMethod,
  PaymentReviewReason,
  PaymentStatus,
} from '../../../../src/module/payment/domain/payment-state';
import type { VnPayGatewayService } from '../../../../src/module/payment/vnpay-gateway.service';
import { TypeOrmPaymentAcceptanceStore } from '../../../../src/module/payment/persistence/typeorm-payment-acceptance.store';
import { TypeOrmPaymentRefundStore } from '../../../../src/module/payment/persistence/typeorm-payment-refund.store';

describe('PaymentService characterization', () => {
  let dataSource: { transaction: jest.Mock; getRepository: jest.Mock };
  let paymentRepo: {
    findOneBy: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
    update: jest.Mock;
  };
  let refundRepo: {
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let bookingRepo: {
    findOneBy: jest.Mock;
    exists: jest.Mock;
  };
  let gateway: {
    createPaymentRequest: jest.Mock;
    verifyPaymentCallback: jest.Mock;
    isEnabled: jest.Mock;
    lookupTransaction: jest.Mock;
    requestRefund: jest.Mock;
  };
  let auditLogService: { record: jest.Mock };
  let paymentRefundService: PaymentRefundService;
  let service: PaymentService;
  let warnSpy: jest.SpyInstance;
  let recordedContexts: TransactionContext[];

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    currentRefundFixture = null;
    recordedContexts = [];
    paymentRepo = {
      findOneBy: jest.fn(),
      findOne: jest.fn(
        (options: { where: Record<string, unknown> }) =>
          paymentRepo.findOneBy(options.where) as Promise<Payment | null>,
      ),
      createQueryBuilder: jest.fn(),
      update: jest.fn(),
    };
    refundRepo = {
      findOneBy: jest.fn((criteria: Record<string, unknown>) => {
        const key = criteria.idempotencyKey;
        return Promise.resolve(
          typeof key === 'string' &&
            currentRefundFixture?.idempotencyKey === key
            ? currentRefundFixture
            : null,
        );
      }),
      create: jest.fn((value: Partial<PaymentRefund>) =>
        Object.assign(refundFixture(), value),
      ),
      save: jest.fn((value: PaymentRefund) => {
        currentRefundFixture = value;
        return Promise.resolve(value);
      }),
    };
    bookingRepo = {
      findOneBy: jest.fn(),
      exists: jest.fn(),
    };
    dataSource = {
      transaction: jest.fn(),
      getRepository: jest.fn((entity: unknown) =>
        entity === Payment
          ? paymentRepo
          : entity === PaymentRefund
            ? refundRepo
            : bookingRepo,
      ),
    };
    gateway = {
      createPaymentRequest: jest.fn(),
      verifyPaymentCallback: jest.fn(),
      isEnabled: jest.fn(() => true),
      lookupTransaction: jest.fn(),
      requestRefund: jest.fn(),
    };
    const auditRecord = jest.fn().mockResolvedValue(undefined);
    const config = { getOrThrow: jest.fn(() => 15) };

    const paymentQueryService = new PaymentQueryService(
      paymentRepo as unknown as Repository<Payment>,
      bookingRepo as unknown as Repository<Booking>,
    );
    const transactionRunner = new TypeOrmTransactionRunner(
      dataSource as unknown as DataSource,
    );
    const acceptanceStore = new TypeOrmPaymentAcceptanceStore(
      dataSource as unknown as DataSource,
      transactionRunner,
    );
    const refundStore = new TypeOrmPaymentRefundStore(
      dataSource as unknown as DataSource,
      transactionRunner,
    );
    const roomCalendarStore = new TypeOrmRoomCalendarStore(transactionRunner);
    auditLogService = {
      record: jest.fn(async (context: TransactionContext, input) => {
        recordedContexts.push(context);
        await auditRecord(transactionRunner.managerFor(context), input);
      }),
    };
    const lifecycleCoordinator = new BookingPaymentLifecycleService(
      transactionRunner,
      config as unknown as ConfigService,
      new BookingTransitionPolicy(),
      new TypeOrmBookingLifecycleStore(transactionRunner),
      new TypeOrmBookingPaymentStateStore(transactionRunner),
      roomCalendarStore,
      auditLogService,
      acceptanceStore,
      refundStore,
    );
    const paymentCollectionService = new PaymentCollectionService(
      transactionRunner,
      acceptanceStore,
      lifecycleCoordinator,
      paymentQueryService,
      auditLogService,
      config as unknown as ConfigService,
      gateway as unknown as VnPayGatewayService,
    );
    const paymentManualService = new PaymentManualService(
      transactionRunner,
      acceptanceStore,
      lifecycleCoordinator,
      paymentQueryService,
      config as unknown as ConfigService,
    );
    paymentRefundService = new PaymentRefundService(
      transactionRunner,
      refundStore,
      lifecycleCoordinator,
      paymentQueryService,
      gateway as unknown as VnPayGatewayService,
      auditLogService,
    );
    service = new PaymentService(
      paymentCollectionService,
      paymentManualService,
      paymentQueryService,
      paymentRefundService,
    );
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('records a manual payment atomically and confirms a pending booking', async () => {
    const booking = bookingFixture();
    const payment = paymentFixture({
      method: PaymentMethod.CASH,
      status: PaymentStatus.SUCCESS,
      createdByUserId: '20',
    });
    const manager = createMutationManager(booking, payment);
    dataSource.transaction.mockImplementation(runTransaction(manager));
    paymentRepo.createQueryBuilder.mockReturnValue(createPaymentQuery(payment));

    await expect(
      service.recordManualPayment(
        '20',
        '100',
        'manual-key-0001',
        {
          method: PaymentMethod.CASH,
        },
        'request-manual-1',
      ),
    ).resolves.toMatchObject({
      id: '500',
      method: PaymentMethod.CASH,
      status: PaymentStatus.SUCCESS,
    });

    expect(booking).toMatchObject({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
      paymentExpiresAt: null,
    });
    expect(manager.paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: '100',
        amount: '2000000.00',
        idempotencyKey: 'manual-key-0001',
      }),
    );
    expect(auditLogService.record).toHaveBeenCalledTimes(2);
    expect(auditLogService.record).toHaveBeenNthCalledWith(
      1,
      recordedContexts[0],
      {
        actorType: AuditActorType.USER,
        actorId: '20',
        action: AuditAction.PAYMENT_CONFIRMED,
        entityType: AuditEntityType.PAYMENT,
        entityId: '500',
        requestId: 'request-manual-1',
        metadata: {
          bookingId: '100',
          method: PaymentMethod.CASH,
        },
      },
    );
    expect(auditLogService.record).toHaveBeenNthCalledWith(
      2,
      recordedContexts[0],
      {
        actorType: AuditActorType.USER,
        actorId: '20',
        action: AuditAction.BOOKING_STATUS_CHANGED,
        entityType: AuditEntityType.BOOKING,
        entityId: '100',
        requestId: 'request-manual-1',
        metadata: {
          fromStatus: BookingStatus.PENDING_PAYMENT,
          toStatus: BookingStatus.CONFIRMED,
          paymentId: '500',
        },
      },
    );
  });

  it('returns the original manual payment for the same idempotent request', async () => {
    const booking = bookingFixture();
    const payment = paymentFixture({
      method: PaymentMethod.BANK_TRANSFER,
      status: PaymentStatus.SUCCESS,
      createdByUserId: '20',
      idempotencyKey: 'manual-key-0002',
    });
    const manager = createMutationManager(booking, payment, {
      existingPayment: payment,
    });
    dataSource.transaction.mockImplementation(runTransaction(manager));
    paymentRepo.createQueryBuilder.mockReturnValue(createPaymentQuery(payment));

    await service.recordManualPayment(
      '20',
      '100',
      'manual-key-0002',
      {
        method: PaymentMethod.BANK_TRANSFER,
      },
      'request-manual-replay',
    );

    expect(manager.paymentCreate).not.toHaveBeenCalled();
    expect(manager.bookingSave).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('does not audit a booking status transition when manual payment leaves it confirmed', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.UNPAID,
      paymentExpiresAt: null,
    });
    const payment = paymentFixture({
      method: PaymentMethod.CASH,
      status: PaymentStatus.SUCCESS,
      createdByUserId: '20',
    });
    const manager = createMutationManager(booking, payment);
    dataSource.transaction.mockImplementation(runTransaction(manager));
    paymentRepo.createQueryBuilder.mockReturnValue(createPaymentQuery(payment));

    await service.recordManualPayment(
      '20',
      '100',
      'manual-key-confirmed-booking',
      { method: PaymentMethod.CASH },
      'request-manual-confirmed-booking',
    );

    expect(booking.status).toBe(BookingStatus.CONFIRMED);
    expect(auditLogService.record).toHaveBeenCalledTimes(1);
    expect(auditLogService.record).toHaveBeenCalledWith(
      recordedContexts[0],
      expect.objectContaining({
        action: AuditAction.PAYMENT_CONFIRMED,
        entityType: AuditEntityType.PAYMENT,
      }),
    );
  });

  it('rejects reuse of a manual idempotency key for another request', async () => {
    const payment = paymentFixture({
      bookingId: '999',
      method: PaymentMethod.CASH,
      createdByUserId: '20',
      idempotencyKey: 'manual-key-0003',
    });
    const manager = createMutationManager(bookingFixture(), payment, {
      existingPayment: payment,
    });
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(
      service.recordManualPayment('20', '100', 'manual-key-0003', {
        method: PaymentMethod.CASH,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a pending VNPay payment with a stable gateway reference and deadline', async () => {
    const booking = bookingFixture();
    const payment = paymentFixture({
      method: PaymentMethod.VNPAY,
      status: PaymentStatus.PENDING,
      gatewayName: 'VNPAY',
      idempotencyKey: 'online-key-0001',
      expiresAt: booking.paymentExpiresAt,
    });
    const manager = createMutationManager(booking, payment);
    dataSource.transaction.mockImplementation(runTransaction(manager));
    paymentRepo.findOneBy.mockResolvedValue(payment);
    gateway.createPaymentRequest.mockReturnValue({
      redirectUrl: 'https://vnpay.test/pay/P500',
      transactionDate: '20300101070000',
    });
    paymentRepo.createQueryBuilder.mockReturnValue(createPaymentQuery(payment));

    await expect(
      service.createVnPayPayment('10', '100', 'online-key-0001', '127.0.0.1', {
        locale: 'vn',
      }),
    ).resolves.toMatchObject({
      paymentUrl: 'https://vnpay.test/pay/P500',
      payment: {
        id: '500',
        gatewayReference: 'P500',
        status: PaymentStatus.PENDING,
      },
    });

    expect(gateway.createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: booking.totalAmount,
        transactionReference: 'P500',
        expiresAt: booking.paymentExpiresAt,
      }),
    );
  });

  it('rejects an IPN with an invalid signature without touching the database', async () => {
    gateway.verifyPaymentCallback.mockReturnValue({
      isValid: false,
    });

    await expect(service.handleVnPayIpn({})).resolves.toEqual({
      RspCode: '97',
      Message: 'Invalid signature',
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects a signed IPN whose amount does not match the payment snapshot', async () => {
    const payment = paymentFixture({
      method: PaymentMethod.VNPAY,
      status: PaymentStatus.PENDING,
      gatewayReference: 'P500',
    });
    mockValidCallback(gateway, { vnp_Amount: '999' });
    paymentRepo.findOneBy.mockResolvedValue(payment);

    await expect(service.handleVnPayIpn({})).resolves.toEqual({
      RspCode: '04',
      Message: 'Invalid amount',
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects a signed successful IPN without a valid VNPay payment date', async () => {
    mockValidCallback(gateway, { vnp_PayDate: 'invalid-date' });

    await expect(service.handleVnPayIpn({})).resolves.toEqual({
      RspCode: '99',
      Message: 'Input data required',
    });
    expect(paymentRepo.findOneBy).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('keeps the VNPay Return path read-only and leaves confirmation to IPN', async () => {
    const payment = paymentFixture({
      method: PaymentMethod.VNPAY,
      status: PaymentStatus.PENDING,
      gatewayReference: 'P500',
    });
    mockValidCallback(gateway);
    paymentRepo.findOneBy.mockResolvedValue(payment);

    await expect(
      service.handleVnPayReturn({}, 'request-vnpay-return'),
    ).resolves.toEqual({
      validSignature: true,
      paymentId: payment.id,
      bookingId: payment.bookingId,
      paymentStatus: PaymentStatus.PENDING,
      responseCode: '00',
      transactionStatus: '00',
    });

    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('applies a verified successful IPN to both payment and booking', async () => {
    const booking = bookingFixture();
    const payment = paymentFixture({
      method: PaymentMethod.VNPAY,
      status: PaymentStatus.PENDING,
      gatewayReference: 'P500',
    });
    const manager = createMutationManager(booking, payment);
    mockValidCallback(gateway);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(
      service.handleVnPayIpn({}, 'request-ipn-success'),
    ).resolves.toEqual({
      RspCode: '00',
      Message: 'Confirm Success',
    });
    expect(payment).toMatchObject({
      status: PaymentStatus.SUCCESS,
      gatewayTransactionId: '123456',
      gatewayResponseCode: '00',
      gatewayTransactionStatus: '00',
    });
    expect(booking).toMatchObject({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    expect(auditLogService.record).toHaveBeenCalledTimes(2);
    expect(auditLogService.record).toHaveBeenNthCalledWith(
      1,
      recordedContexts[0],
      {
        actorType: AuditActorType.SYSTEM,
        actorId: null,
        action: AuditAction.PAYMENT_CONFIRMED,
        entityType: AuditEntityType.PAYMENT,
        entityId: '500',
        requestId: 'request-ipn-success',
        metadata: {
          bookingId: '100',
          source: 'IPN',
          paymentStatus: PaymentStatus.SUCCESS,
        },
      },
    );
    expect(auditLogService.record).toHaveBeenNthCalledWith(
      2,
      recordedContexts[0],
      {
        actorType: AuditActorType.SYSTEM,
        actorId: null,
        action: AuditAction.BOOKING_STATUS_CHANGED,
        entityType: AuditEntityType.BOOKING,
        entityId: '100',
        requestId: 'request-ipn-success',
        metadata: {
          fromStatus: BookingStatus.PENDING_PAYMENT,
          toStatus: BookingStatus.CONFIRMED,
          paymentId: '500',
        },
      },
    );
  });

  it('does not duplicate the confirmation audit for a successful IPN replay', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = paymentFixture({
      method: PaymentMethod.VNPAY,
      status: PaymentStatus.SUCCESS,
      gatewayReference: 'P500',
      gatewayTransactionId: '123456',
    });
    const manager = createMutationManager(booking, payment);
    mockValidCallback(gateway);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(
      service.handleVnPayIpn({}, 'request-ipn-replay'),
    ).resolves.toEqual({
      RspCode: '02',
      Message: 'Order already confirmed',
    });

    expect(manager.paymentSave).not.toHaveBeenCalled();
    expect(manager.bookingSave).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('does not downgrade a successful payment when a later callback reports failure', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = paymentFixture({
      method: PaymentMethod.VNPAY,
      status: PaymentStatus.SUCCESS,
      gatewayReference: 'P500',
      gatewayTransactionId: '123456',
      gatewayResponseCode: '00',
      gatewayTransactionStatus: '00',
      paidAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    const manager = createMutationManager(booking, payment);
    mockValidCallback(gateway, {
      vnp_ResponseCode: '24',
      vnp_TransactionStatus: '02',
    });
    paymentRepo.findOneBy.mockResolvedValue(payment);
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(service.handleVnPayIpn({})).resolves.toEqual({
      RspCode: '02',
      Message: 'Order already confirmed',
    });

    expect(payment).toMatchObject({
      status: PaymentStatus.SUCCESS,
      gatewayTransactionId: '123456',
      gatewayResponseCode: '00',
      gatewayTransactionStatus: '00',
    });
    expect(booking).toMatchObject({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    expect(manager.paymentSave).not.toHaveBeenCalled();
    expect(manager.bookingSave).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('does not acknowledge a callback when its transaction id violates the database uniqueness guard', async () => {
    const booking = bookingFixture();
    const payment = paymentFixture({
      method: PaymentMethod.VNPAY,
      status: PaymentStatus.PENDING,
      gatewayReference: 'P500',
    });
    const manager = createMutationManager(booking, payment);
    const duplicateError = Object.assign(new Error('Duplicate entry'), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
      sqlMessage:
        "Duplicate entry 'shared-transaction' for key 'uq_payments_gateway_transaction'",
    });
    manager.paymentSave.mockRejectedValueOnce(duplicateError);
    mockValidCallback(gateway, {
      vnp_TransactionNo: 'shared-transaction',
    });
    paymentRepo.findOneBy.mockResolvedValue(payment);
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(service.handleVnPayIpn({})).resolves.toEqual({
      RspCode: '99',
      Message: 'Unknown error',
    });

    expect(manager.bookingSave).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('marks a late success for a cancelled booking as REQUIRES_REVIEW', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CANCELLED,
      paymentStatus: BookingPaymentStatus.UNPAID,
    });
    const payment = paymentFixture({
      method: PaymentMethod.VNPAY,
      status: PaymentStatus.FAILED,
      gatewayReference: 'P500',
      gatewayResponseCode: 'EXPIRED',
    });
    const manager = createMutationManager(booking, payment);
    mockValidCallback(gateway);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(service.handleVnPayIpn({})).resolves.toEqual({
      RspCode: '00',
      Message: 'Confirm Success',
    });
    expect(payment.status).toBe(PaymentStatus.REQUIRES_REVIEW);
    expect(payment).toMatchObject({
      reviewReason: PaymentReviewReason.BOOKING_CANCELLED,
      reviewCanonicalPaymentId: null,
    });
    expect(booking.status).toBe(BookingStatus.CANCELLED);
    expect(manager.bookingSave).not.toHaveBeenCalled();
  });

  it('logs the correct review reason when another payment already succeeded', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = paymentFixture({
      method: PaymentMethod.VNPAY,
      status: PaymentStatus.FAILED,
      gatewayReference: 'P500',
      gatewayResponseCode: 'EXPIRED',
    });
    const canonicalPayment = refundableVnPayPayment({ id: '501' });
    const manager = createMutationManager(booking, payment, {
      canonicalPayment,
    });
    mockValidCallback(gateway);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(
      service.handleVnPayIpn({}, 'request-review-reason'),
    ).resolves.toEqual({
      RspCode: '00',
      Message: 'Confirm Success',
    });
    expect(payment.status).toBe(PaymentStatus.REQUIRES_REVIEW);
    expect(payment).toMatchObject({
      reviewReason: PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT,
      reviewCanonicalPaymentId: canonicalPayment.id,
    });
    expect(canonicalPayment.status).toBe(PaymentStatus.SUCCESS);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('reason=ANOTHER_SUCCESSFUL_PAYMENT'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('requestId=request-review-reason'),
    );
  });

  it('treats a refund-pending accepted payment as the canonical lineage', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
      acceptedPaymentId: '501',
    });
    const payment = paymentFixture({
      method: PaymentMethod.VNPAY,
      status: PaymentStatus.FAILED,
      gatewayReference: 'P500',
      gatewayResponseCode: 'EXPIRED',
    });
    const canonicalPayment = refundableVnPayPayment({
      id: '501',
      status: PaymentStatus.REFUND_PENDING,
      refund: refundFixture({
        paymentId: '501',
        previousPaymentStatus: PaymentStatus.SUCCESS,
      }),
    });
    const manager = createMutationManager(booking, payment, {
      canonicalPayment,
    });
    mockValidCallback(gateway);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(service.handleVnPayIpn({})).resolves.toEqual({
      RspCode: '00',
      Message: 'Confirm Success',
    });
    expect(payment).toMatchObject({
      status: PaymentStatus.REQUIRES_REVIEW,
      reviewReason: PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT,
      reviewCanonicalPaymentId: '501',
    });
  });

  it('rejects a VNPay refund when the payment has not succeeded', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = refundableVnPayPayment({
      status: PaymentStatus.PENDING,
    });
    const manager = createMutationManager(booking, payment);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(
      service.refund('20', '500', 'refund-key-pending-payment', '127.0.0.1', {
        reason: 'Must not refund a pending payment',
      }),
    ).rejects.toThrow('Payment hien khong the hoan tien.');

    expect(gateway.requestRefund).not.toHaveBeenCalled();
    expect(manager.paymentSave).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('rejects a refund when the booking status is not refundable', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CHECKED_IN,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = refundableVnPayPayment();
    const manager = createMutationManager(booking, payment);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(
      service.refund(
        '20',
        '500',
        'refund-key-checked-in-booking',
        '127.0.0.1',
        { reason: 'Must not refund after check-in' },
      ),
    ).rejects.toThrow('Khong the hoan tien booking o trang thai hien tai.');

    expect(gateway.requestRefund).not.toHaveBeenCalled();
    expect(manager.paymentSave).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('refunds a successful manual payment and releases the room calendar atomically', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = paymentFixture({
      method: PaymentMethod.CASH,
      status: PaymentStatus.SUCCESS,
      createdByUserId: '20',
    });
    const manager = createMutationManager(booking, payment);
    paymentRepo.findOneBy
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce(payment);
    paymentRepo.createQueryBuilder.mockReturnValue(createPaymentQuery(payment));
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await service.refund(
      '20',
      '500',
      undefined,
      undefined,
      {
        reason: 'Guest cancelled',
      },
      'request-manual-refund',
    );

    expect(payment.status).toBe(PaymentStatus.REFUNDED);
    expect(payment.refund).toMatchObject({
      refundedByUserId: '20',
      reason: 'Guest cancelled',
    });
    expect(booking).toMatchObject({
      status: BookingStatus.CANCELLED,
      paymentStatus: BookingPaymentStatus.REFUNDED,
    });
    expect(manager.calendarDelete).toHaveBeenCalledWith({ bookingId: '100' });
    expect(auditLogService.record).toHaveBeenCalledTimes(2);
    expect(auditLogService.record).toHaveBeenNthCalledWith(
      1,
      recordedContexts[0],
      {
        actorType: AuditActorType.USER,
        actorId: '20',
        action: AuditAction.REFUND_COMPLETED,
        entityType: AuditEntityType.PAYMENT,
        entityId: '500',
        requestId: 'request-manual-refund',
        metadata: {
          bookingId: '100',
          method: PaymentMethod.CASH,
        },
      },
    );
    expect(auditLogService.record).toHaveBeenNthCalledWith(
      2,
      recordedContexts[0],
      {
        actorType: AuditActorType.USER,
        actorId: '20',
        action: AuditAction.BOOKING_CANCELLED,
        entityType: AuditEntityType.BOOKING,
        entityId: '100',
        requestId: 'request-manual-refund',
        metadata: {
          fromStatus: BookingStatus.CONFIRMED,
          toStatus: BookingStatus.CANCELLED,
          paymentId: '500',
        },
      },
    );
  });

  it('does not duplicate refund audits for an already refunded manual payment', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CANCELLED,
      paymentStatus: BookingPaymentStatus.REFUNDED,
    });
    const payment = paymentFixture({
      method: PaymentMethod.CASH,
      status: PaymentStatus.REFUNDED,
      refund: refundFixture({
        refundedByUserId: '20',
        refundedAt: new Date('2030-01-01T00:00:00.000Z'),
      }),
    });
    const manager = createMutationManager(booking, payment);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    paymentRepo.createQueryBuilder.mockReturnValue(createPaymentQuery(payment));
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(
      service.refund(
        '20',
        '500',
        undefined,
        undefined,
        { reason: 'Replay' },
        'request-manual-refund-replay',
      ),
    ).resolves.toMatchObject({ status: PaymentStatus.REFUNDED });

    expect(manager.paymentSave).not.toHaveBeenCalled();
    expect(manager.bookingSave).not.toHaveBeenCalled();
    expect(manager.calendarDelete).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('keeps a VNPay refund pending when the provider times out', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = paymentFixture({
      method: PaymentMethod.VNPAY,
      status: PaymentStatus.SUCCESS,
      gatewayName: 'VNPAY',
      gatewayReference: 'P500',
      gatewayTransactionId: '123456',
      gatewayTransactionDate: '20300101070000',
    });
    const manager = createMutationManager(booking, payment);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    paymentRepo.createQueryBuilder.mockReturnValue(createPaymentQuery(payment));
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.requestRefund.mockRejectedValue(new Error('provider timeout'));

    await expect(
      service.refund(
        '20',
        '500',
        'refund-key-0001',
        '127.0.0.1',
        {
          reason: 'Guest cancelled',
        },
        'request-refund-timeout',
      ),
    ).rejects.toHaveProperty(
      'response.errorCode',
      ErrorCode.PAYMENT_REFUND_OUTCOME_UNKNOWN,
    );

    expect(payment.status).toBe(PaymentStatus.REFUND_PENDING);
    expect(payment.refund).toMatchObject({
      idempotencyKey: 'refund-key-0001',
      previousPaymentStatus: PaymentStatus.SUCCESS,
    });
    expect(booking.paymentStatus).toBe(BookingPaymentStatus.PAID);
    expect(auditLogService.record).toHaveBeenCalledTimes(1);
    expect(auditLogService.record).toHaveBeenCalledWith(
      recordedContexts[0],
      expect.objectContaining({
        actorType: AuditActorType.USER,
        actorId: '20',
        action: AuditAction.REFUND_REQUESTED,
        entityType: AuditEntityType.PAYMENT,
        entityId: '500',
        requestId: 'request-refund-timeout',
      }),
    );
  });

  it('does not duplicate REFUND_REQUESTED for a pending VNPay refund replay', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = refundableVnPayPayment({
      status: PaymentStatus.REFUND_PENDING,
      refund: refundFixture({
        idempotencyKey: 'refund-key-replay',
        requestId: 'R123',
        previousPaymentStatus: PaymentStatus.SUCCESS,
        reason: 'Guest cancelled',
        refundedByUserId: '20',
      }),
    });
    const manager = createMutationManager(booking, payment);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    paymentRepo.createQueryBuilder.mockReturnValue(createPaymentQuery(payment));
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.lookupTransaction.mockResolvedValue({
      ...successfulRefundResult(),
      isVerified: false,
      isSuccess: false,
      message: 'Unverified query result',
    });

    await expect(
      service.refund(
        '20',
        '500',
        'refund-key-replay',
        '127.0.0.1',
        { reason: 'Guest cancelled' },
        'request-refund-replay',
      ),
    ).rejects.toThrow('Phan hoi doi soat VNPay khong xac minh duoc chu ky.');

    expect(gateway.requestRefund).not.toHaveBeenCalled();
    expect(gateway.lookupTransaction).toHaveBeenCalledTimes(1);
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('completes a verified VNPay refund and releases the booking calendar', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = refundableVnPayPayment();
    const manager = createMutationManager(booking, payment);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    paymentRepo.createQueryBuilder.mockReturnValue(createPaymentQuery(payment));
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.requestRefund.mockResolvedValue(successfulRefundResult());

    await expect(
      service.refund(
        '20',
        '500',
        'refund-key-0002',
        '127.0.0.1',
        {
          reason: 'Guest cancelled',
        },
        'request-refund-success',
      ),
    ).resolves.toMatchObject({
      id: '500',
      status: PaymentStatus.REFUNDED,
    });

    expect(booking).toMatchObject({
      status: BookingStatus.CANCELLED,
      paymentStatus: BookingPaymentStatus.REFUNDED,
    });
    expect(manager.calendarDelete).toHaveBeenCalledWith({ bookingId: '100' });
    expect(auditLogService.record).toHaveBeenCalledTimes(3);
    expect(auditLogService.record).toHaveBeenNthCalledWith(
      1,
      recordedContexts[0],
      expect.objectContaining({
        action: AuditAction.REFUND_REQUESTED,
        requestId: 'request-refund-success',
      }),
    );
    expect(auditLogService.record).toHaveBeenNthCalledWith(
      2,
      recordedContexts[0],
      expect.objectContaining({
        action: AuditAction.REFUND_COMPLETED,
        requestId: 'request-refund-success',
      }),
    );
    expect(auditLogService.record).toHaveBeenNthCalledWith(
      3,
      recordedContexts[0],
      expect.objectContaining({
        action: AuditAction.BOOKING_CANCELLED,
        entityType: AuditEntityType.BOOKING,
        entityId: '100',
        requestId: 'request-refund-success',
      }),
    );
  });

  it('does not duplicate BOOKING_CANCELLED when refunding a reviewed payment for an already cancelled booking', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CANCELLED,
      paymentStatus: BookingPaymentStatus.UNPAID,
    });
    const payment = refundableVnPayPayment({
      status: PaymentStatus.REQUIRES_REVIEW,
      reviewReason: PaymentReviewReason.BOOKING_CANCELLED,
    });
    const manager = createMutationManager(booking, payment);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    paymentRepo.createQueryBuilder.mockReturnValue(createPaymentQuery(payment));
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.requestRefund.mockResolvedValue(successfulRefundResult());

    await expect(
      service.refund(
        '20',
        '500',
        'refund-key-reviewed-payment',
        '127.0.0.1',
        { reason: 'Late collection on cancelled booking' },
        'request-refund-reviewed-payment',
      ),
    ).resolves.toMatchObject({ status: PaymentStatus.REFUNDED });

    expect(booking.status).toBe(BookingStatus.CANCELLED);
    expect(auditLogService.record).toHaveBeenCalledTimes(2);
    expect(auditLogService.record).toHaveBeenNthCalledWith(
      1,
      recordedContexts[0],
      expect.objectContaining({ action: AuditAction.REFUND_REQUESTED }),
    );
    expect(auditLogService.record).toHaveBeenNthCalledWith(
      2,
      recordedContexts[0],
      expect.objectContaining({ action: AuditAction.REFUND_COMPLETED }),
    );
  });

  it('restores SUCCESS when VNPay explicitly rejects a refund', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = refundableVnPayPayment();
    const manager = createMutationManager(booking, payment);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    paymentRepo.createQueryBuilder.mockReturnValue(createPaymentQuery(payment));
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.requestRefund.mockResolvedValue({
      ...successfulRefundResult(),
      isSuccess: false,
      providerResponseCode: '24',
      providerTransactionStatus: '02',
      message: 'Refund rejected',
    });

    await expect(
      service.refund('20', '500', 'refund-key-0003', '127.0.0.1', {
        reason: 'Guest cancelled',
      }),
    ).rejects.toHaveProperty(
      'response.errorCode',
      ErrorCode.PAYMENT_REFUND_REJECTED,
    );

    expect(payment.status).toBe(PaymentStatus.SUCCESS);
    expect(booking.paymentStatus).toBe(BookingPaymentStatus.PAID);
  });

  it('keeps an unverified VNPay result pending for reconciliation', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = refundableVnPayPayment();
    const manager = createMutationManager(booking, payment);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    paymentRepo.createQueryBuilder.mockReturnValue(createPaymentQuery(payment));
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.requestRefund.mockResolvedValue({
      ...successfulRefundResult(),
      isVerified: false,
      isSuccess: false,
      providerResponseCode: '99',
      providerTransactionStatus: '05',
      message: 'Unknown result',
    });

    await expect(
      service.refund('20', '500', 'refund-key-0004', '127.0.0.1', {
        reason: 'Guest cancelled',
      }),
    ).rejects.toHaveProperty(
      'response.errorCode',
      ErrorCode.PAYMENT_REFUND_OUTCOME_UNKNOWN,
    );

    expect(payment.status).toBe(PaymentStatus.REFUND_PENDING);
    expect(payment.refund).toMatchObject({
      gatewayTransactionId: null,
      responseCode: null,
      transactionStatus: null,
    });
    expect(booking.paymentStatus).toBe(BookingPaymentStatus.PAID);
  });

  it('keeps a verified refund without a transaction id pending', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = refundableVnPayPayment();
    const manager = createMutationManager(booking, payment);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    paymentRepo.createQueryBuilder.mockReturnValue(createPaymentQuery(payment));
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.requestRefund.mockResolvedValue({
      ...successfulRefundResult(),
      providerTransactionId: null,
    });

    await expect(
      service.refund('20', '500', 'refund-key-no-transaction', '127.0.0.1', {
        reason: 'Guest cancelled',
      }),
    ).rejects.toHaveProperty(
      'response.errorCode',
      ErrorCode.PAYMENT_REFUND_OUTCOME_UNKNOWN,
    );
    expect(payment.status).toBe(PaymentStatus.REFUND_PENDING);
    expect(booking.paymentStatus).toBe(BookingPaymentStatus.PAID);
  });

  it('does not persist unverified reconciliation identifiers or codes', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = refundableVnPayPayment({
      status: PaymentStatus.REFUND_PENDING,
      refund: refundFixture({
        idempotencyKey: 'refund-key-unverified-query',
        requestId: 'R123',
        previousPaymentStatus: PaymentStatus.SUCCESS,
        reason: 'Guest cancelled',
        refundedByUserId: '20',
      }),
    });
    const manager = createMutationManager(booking, payment);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    paymentRepo.createQueryBuilder.mockReturnValue(createPaymentQuery(payment));
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.lookupTransaction.mockResolvedValue({
      ...successfulRefundResult(),
      isVerified: false,
      providerResponseCode: '99',
      providerTransactionStatus: '05',
      providerTransactionId: '999999',
      message: 'Unverified query result',
    });

    await expect(
      service.reconcileVnPayRefund(
        '20',
        '500',
        '127.0.0.1',
        'request-reconcile-unverified',
      ),
    ).rejects.toThrow('Phan hoi doi soat VNPay khong xac minh duoc chu ky.');
    expect(payment.status).toBe(PaymentStatus.REFUND_PENDING);
    expect(payment.refund).toMatchObject({
      gatewayTransactionId: null,
      responseCode: null,
      transactionStatus: null,
    });
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('reconciles a pending VNPay refund without sending another refund mutation', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = refundableVnPayPayment({
      status: PaymentStatus.REFUND_PENDING,
      refund: refundFixture({
        idempotencyKey: 'refund-key-0005',
        requestId: 'R123',
        previousPaymentStatus: PaymentStatus.SUCCESS,
        reason: 'Guest cancelled',
        refundedByUserId: '20',
      }),
    });
    const manager = createMutationManager(booking, payment);
    paymentRepo.findOneBy.mockResolvedValue(payment);
    paymentRepo.createQueryBuilder.mockReturnValue(createPaymentQuery(payment));
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.lookupTransaction.mockResolvedValue(successfulRefundResult());

    await expect(
      service.reconcileVnPayRefund(
        '20',
        '500',
        '127.0.0.1',
        'request-reconcile-success',
      ),
    ).resolves.toMatchObject({
      id: '500',
      status: PaymentStatus.REFUNDED,
    });

    expect(gateway.requestRefund).not.toHaveBeenCalled();
    expect(gateway.lookupTransaction).toHaveBeenCalledTimes(1);
    expect(booking.paymentStatus).toBe(BookingPaymentStatus.REFUNDED);
    expect(auditLogService.record).toHaveBeenCalledTimes(2);
    expect(auditLogService.record).toHaveBeenNthCalledWith(
      1,
      recordedContexts[0],
      expect.objectContaining({
        actorType: AuditActorType.USER,
        actorId: '20',
        action: AuditAction.REFUND_COMPLETED,
        entityType: AuditEntityType.PAYMENT,
        entityId: '500',
        requestId: 'request-reconcile-success',
      }),
    );
    expect(auditLogService.record).toHaveBeenNthCalledWith(
      2,
      recordedContexts[0],
      expect.objectContaining({
        actorType: AuditActorType.USER,
        actorId: '20',
        action: AuditAction.BOOKING_CANCELLED,
        entityType: AuditEntityType.BOOKING,
        entityId: '100',
        requestId: 'request-reconcile-success',
      }),
    );
  });

  it('delegates duplicate-charge resolution through the PaymentService facade', async () => {
    const expected = { id: '500' } as PaymentResponse;
    const resolve = jest
      .spyOn(paymentRefundService, 'resolveDuplicateCharge')
      .mockResolvedValue(expected);

    await expect(
      service.resolveDuplicateCharge(
        '20',
        '500',
        'duplicate-refund-key-facade',
        '127.0.0.1',
        'request-duplicate-facade',
      ),
    ).resolves.toBe(expected);
    expect(resolve).toHaveBeenCalledWith(
      '20',
      '500',
      'duplicate-refund-key-facade',
      '127.0.0.1',
      'request-duplicate-facade',
    );
  });

  it('refunds only the duplicate charge and preserves the paid booking and calendar', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const duplicate = duplicateVnPayPayment();
    const canonical = refundableVnPayPayment({
      id: '501',
      gatewayReference: 'P501',
      gatewayTransactionId: 'canonical-transaction',
    });
    const manager = createMutationManager(booking, duplicate, {
      canonicalPayment: canonical,
    });
    paymentRepo.findOneBy.mockResolvedValue(duplicate);
    paymentRepo.createQueryBuilder.mockReturnValue(
      createPaymentQuery(duplicate),
    );
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.requestRefund.mockResolvedValue(successfulRefundResult());

    await expect(
      service.resolveDuplicateCharge(
        '20',
        duplicate.id,
        'duplicate-refund-key-success',
        '127.0.0.1',
        'request-duplicate-success',
      ),
    ).resolves.toMatchObject({
      id: duplicate.id,
      status: PaymentStatus.REFUNDED,
    });

    expect(duplicate.status).toBe(PaymentStatus.REFUNDED);
    expect(canonical.status).toBe(PaymentStatus.SUCCESS);
    expect(booking).toMatchObject({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
      cancelledAt: null,
      cancellationReason: null,
    });
    expect(manager.bookingSave).not.toHaveBeenCalled();
    expect(manager.calendarDelete).not.toHaveBeenCalled();
    expect(gateway.requestRefund).toHaveBeenCalledTimes(1);
    expect(auditLogService.record).toHaveBeenCalledTimes(2);
    expect(duplicate.refund?.requestId).toEqual(expect.any(String));
    const auditInputs = getRecordedAuditInputs(auditLogService.record);

    for (const action of [
      AuditAction.REFUND_REQUESTED,
      AuditAction.REFUND_COMPLETED,
    ]) {
      const input = auditInputs.find(
        (candidate) => candidate.action === action,
      );
      expect(input).toMatchObject({
        actorType: AuditActorType.USER,
        actorId: '20',
        action,
        entityType: AuditEntityType.PAYMENT,
        entityId: duplicate.id,
        requestId: 'request-duplicate-success',
      });
      expect(input?.metadata).toMatchObject({
        bookingId: booking.id,
        canonicalPaymentId: canonical.id,
        duplicatePaymentId: duplicate.id,
        reason: PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT,
        refundRequestId: duplicate.refund?.requestId,
      });
    }
    expect(auditLogService.record).not.toHaveBeenCalledWith(
      recordedContexts[0],
      expect.objectContaining({ action: AuditAction.BOOKING_CANCELLED }),
    );
  });

  it('rejects the canonical successful payment as a duplicate-refund target', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const canonical = refundableVnPayPayment({ id: '501' });
    const manager = createMutationManager(booking, canonical);
    paymentRepo.findOneBy.mockResolvedValue(canonical);
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(
      service.resolveDuplicateCharge(
        '20',
        canonical.id,
        'duplicate-refund-key-canonical',
        '127.0.0.1',
      ),
    ).rejects.toThrow();
    expect(gateway.requestRefund).not.toHaveBeenCalled();
    expect(manager.paymentSave).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('rejects REQUIRES_REVIEW with a non-duplicate review reason', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const reviewed = duplicateVnPayPayment({
      reviewReason: PaymentReviewReason.BOOKING_CANCELLED,
      reviewCanonicalPaymentId: null,
    });
    const manager = createMutationManager(booking, reviewed);
    paymentRepo.findOneBy.mockResolvedValue(reviewed);
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(
      service.resolveDuplicateCharge(
        '20',
        reviewed.id,
        'duplicate-refund-key-wrong-reason',
        '127.0.0.1',
      ),
    ).rejects.toThrow();
    expect(gateway.requestRefund).not.toHaveBeenCalled();
    expect(manager.paymentSave).not.toHaveBeenCalled();
  });

  it('rejects a duplicate review when its canonical SUCCESS no longer exists', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const duplicate = duplicateVnPayPayment();
    const manager = createMutationManager(booking, duplicate, {
      canonicalPayment: null,
    });
    paymentRepo.findOneBy.mockResolvedValue(duplicate);
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(
      service.resolveDuplicateCharge(
        '20',
        duplicate.id,
        'duplicate-refund-key-missing-canonical',
        '127.0.0.1',
      ),
    ).rejects.toThrow();
    expect(gateway.requestRefund).not.toHaveBeenCalled();
    expect(manager.paymentSave).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('rejects a duplicate review missing gateway identity before marking it pending', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const duplicate = duplicateVnPayPayment({
      gatewayTransactionId: null,
    });
    const canonical = refundableVnPayPayment({ id: '501' });
    const manager = createMutationManager(booking, duplicate, {
      canonicalPayment: canonical,
    });
    paymentRepo.findOneBy.mockResolvedValue(duplicate);
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(
      service.resolveDuplicateCharge(
        '20',
        duplicate.id,
        'duplicate-refund-key-missing-gateway',
        '127.0.0.1',
      ),
    ).rejects.toThrow();

    expect(duplicate.status).toBe(PaymentStatus.REQUIRES_REVIEW);
    expect(manager.paymentSave).not.toHaveBeenCalled();
    expect(gateway.requestRefund).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('reconciles a pending duplicate refund with the same key without another refund mutation', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const duplicate = duplicateVnPayPayment({
      status: PaymentStatus.REFUND_PENDING,
      refund: refundFixture({
        idempotencyKey: 'duplicate-refund-key-pending',
        requestId: 'R-duplicate-pending',
        previousPaymentStatus: PaymentStatus.REQUIRES_REVIEW,
        refundedByUserId: '20',
      }),
    });
    const canonical = refundableVnPayPayment({ id: '501' });
    const manager = createMutationManager(booking, duplicate, {
      canonicalPayment: canonical,
    });
    paymentRepo.findOneBy.mockResolvedValue(duplicate);
    paymentRepo.createQueryBuilder.mockReturnValue(
      createPaymentQuery(duplicate),
    );
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.lookupTransaction.mockResolvedValue(successfulRefundResult());

    await expect(
      service.resolveDuplicateCharge(
        '20',
        duplicate.id,
        'duplicate-refund-key-pending',
        '127.0.0.1',
        'request-duplicate-pending-replay',
      ),
    ).resolves.toMatchObject({ status: PaymentStatus.REFUNDED });

    expect(gateway.requestRefund).not.toHaveBeenCalled();
    expect(gateway.lookupTransaction).toHaveBeenCalledTimes(1);
    expect(canonical.status).toBe(PaymentStatus.SUCCESS);
    expect(booking).toMatchObject({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    expect(manager.bookingSave).not.toHaveBeenCalled();
    expect(manager.calendarDelete).not.toHaveBeenCalled();
    expect(
      getRecordedAuditInputs(auditLogService.record).filter(
        (input) => input.action === AuditAction.REFUND_REQUESTED,
      ),
    ).toHaveLength(0);
  });

  it('emits one refund mutation and one request audit for concurrent same-key resolution', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const duplicate = duplicateVnPayPayment();
    const canonical = refundableVnPayPayment({ id: '501' });
    const manager = createMutationManager(booking, duplicate, {
      canonicalPayment: canonical,
    });
    paymentRepo.findOneBy.mockResolvedValue(duplicate);
    paymentRepo.createQueryBuilder.mockReturnValue(
      createPaymentQuery(duplicate),
    );
    dataSource.transaction.mockImplementation(runTransaction(manager));

    let signalGatewayStarted!: () => void;
    let resolveGatewayRefund!: (
      result: ReturnType<typeof successfulRefundResult>,
    ) => void;
    const gatewayStarted = new Promise<void>((resolve) => {
      signalGatewayStarted = resolve;
    });
    const pendingGatewayRefund = new Promise<
      ReturnType<typeof successfulRefundResult>
    >((resolve) => {
      resolveGatewayRefund = resolve;
    });
    gateway.requestRefund.mockImplementation(() => {
      signalGatewayStarted();
      return pendingGatewayRefund;
    });
    gateway.lookupTransaction.mockResolvedValue({
      ...successfulRefundResult(),
      isVerified: false,
      isSuccess: false,
      providerResponseCode: '99',
      providerTransactionStatus: '05',
      providerTransactionId: null,
    });

    const first = service.resolveDuplicateCharge(
      '20',
      duplicate.id,
      'duplicate-refund-key-concurrent',
      '127.0.0.1',
      'request-duplicate-concurrent-first',
    );
    await gatewayStarted;
    const second = service.resolveDuplicateCharge(
      '20',
      duplicate.id,
      'duplicate-refund-key-concurrent',
      '127.0.0.1',
      'request-duplicate-concurrent-second',
    );

    await expect(second).rejects.toThrow(
      'Phan hoi doi soat VNPay khong xac minh duoc chu ky.',
    );
    resolveGatewayRefund(successfulRefundResult());
    await expect(first).resolves.toMatchObject({
      status: PaymentStatus.REFUNDED,
    });

    const auditInputs = getRecordedAuditInputs(auditLogService.record);
    expect(gateway.requestRefund).toHaveBeenCalledTimes(1);
    expect(gateway.lookupTransaction).toHaveBeenCalledTimes(1);
    expect(
      auditInputs.filter(
        (input) => input.action === AuditAction.REFUND_REQUESTED,
      ),
    ).toHaveLength(1);
    expect(
      auditInputs.filter(
        (input) => input.action === AuditAction.REFUND_COMPLETED,
      ),
    ).toHaveLength(1);
    expect(canonical.status).toBe(PaymentStatus.SUCCESS);
    expect(booking).toMatchObject({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    expect(manager.bookingSave).not.toHaveBeenCalled();
    expect(manager.calendarDelete).not.toHaveBeenCalled();
  });

  it('returns an already refunded duplicate without calling VNPay or duplicating audits', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const duplicate = duplicateVnPayPayment({
      status: PaymentStatus.REFUNDED,
      refund: refundFixture({
        idempotencyKey: 'duplicate-refund-key-refunded',
        requestId: 'R-duplicate-refunded',
        previousPaymentStatus: PaymentStatus.REQUIRES_REVIEW,
        refundedByUserId: '20',
        refundedAt: new Date(),
      }),
    });
    const canonical = refundableVnPayPayment({ id: '501' });
    const manager = createMutationManager(booking, duplicate, {
      canonicalPayment: canonical,
    });
    paymentRepo.findOneBy.mockResolvedValue(duplicate);
    paymentRepo.createQueryBuilder.mockReturnValue(
      createPaymentQuery(duplicate),
    );
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(
      service.resolveDuplicateCharge(
        '20',
        duplicate.id,
        'duplicate-refund-key-refunded',
        '127.0.0.1',
      ),
    ).resolves.toMatchObject({ status: PaymentStatus.REFUNDED });

    expect(gateway.requestRefund).not.toHaveBeenCalled();
    expect(gateway.lookupTransaction).not.toHaveBeenCalled();
    expect(manager.paymentSave).not.toHaveBeenCalled();
    expect(manager.bookingSave).not.toHaveBeenCalled();
    expect(manager.calendarDelete).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('keeps an unverified duplicate refund pending without mutating booking or calendar', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const duplicate = duplicateVnPayPayment();
    const canonical = refundableVnPayPayment({ id: '501' });
    const manager = createMutationManager(booking, duplicate, {
      canonicalPayment: canonical,
    });
    paymentRepo.findOneBy.mockResolvedValue(duplicate);
    paymentRepo.createQueryBuilder.mockReturnValue(
      createPaymentQuery(duplicate),
    );
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.requestRefund.mockResolvedValue({
      ...successfulRefundResult(),
      isVerified: false,
      isSuccess: false,
      providerResponseCode: '99',
      providerTransactionStatus: '05',
      providerTransactionId: null,
      message: 'Unverified duplicate refund result',
    });

    await expect(
      service.resolveDuplicateCharge(
        '20',
        duplicate.id,
        'duplicate-refund-key-unverified',
        '127.0.0.1',
        'request-duplicate-unverified',
      ),
    ).rejects.toHaveProperty(
      'response.errorCode',
      ErrorCode.PAYMENT_REFUND_OUTCOME_UNKNOWN,
    );

    expect(duplicate.status).toBe(PaymentStatus.REFUND_PENDING);
    expect(canonical.status).toBe(PaymentStatus.SUCCESS);
    expect(booking).toMatchObject({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    expect(manager.bookingSave).not.toHaveBeenCalled();
    expect(manager.calendarDelete).not.toHaveBeenCalled();
    expect(auditLogService.record).toHaveBeenCalledTimes(1);
    expect(duplicate.refund?.requestId).toEqual(expect.any(String));
    const [auditInput] = getRecordedAuditInputs(auditLogService.record);
    expect(auditInput).toMatchObject({ action: AuditAction.REFUND_REQUESTED });
    expect(auditInput?.metadata).toMatchObject({
      bookingId: booking.id,
      canonicalPaymentId: canonical.id,
      duplicatePaymentId: duplicate.id,
      reason: PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT,
      refundRequestId: duplicate.refund?.requestId,
    });
  });

  it('expires only the locked pending VNPay batch', async () => {
    const expired = [
      paymentFixture({
        id: '500',
        method: PaymentMethod.VNPAY,
        status: PaymentStatus.PENDING,
      }),
      paymentFixture({
        id: '501',
        method: PaymentMethod.VNPAY,
        status: PaymentStatus.PENDING,
      }),
    ];
    const save = jest.fn().mockResolvedValue(expired);
    const query = createPaymentQuery(undefined);
    query.getMany.mockResolvedValue(expired);
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Payment) {
          return { createQueryBuilder: () => query, save };
        }
        throw new Error('Unexpected repository');
      }),
    } as unknown as EntityManager;
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(service.expirePendingOnlinePayments()).resolves.toBe(2);
    expect(expired).toEqual([
      expect.objectContaining({
        status: PaymentStatus.FAILED,
        gatewayResponseCode: 'EXPIRED',
      }),
      expect.objectContaining({
        status: PaymentStatus.FAILED,
        gatewayResponseCode: 'EXPIRED',
      }),
    ]);
    expect(save).toHaveBeenCalledWith(expired);
  });
});

interface MutationManager extends EntityManager {
  paymentCreate: jest.Mock;
  paymentSave: jest.Mock;
  bookingSave: jest.Mock;
  calendarDelete: jest.Mock;
}

function createMutationManager(
  booking: Booking,
  payment: Payment,
  options: {
    existingPayment?: Payment | null;
    pendingExists?: boolean;
    canonicalPayment?: Payment | null;
  } = {},
): MutationManager {
  const bookingQuery = createLockedQuery(booking);
  const paymentQuery = createLockedQuery(payment);
  const mutationQuery = createMutationQuery();
  const paymentCreate = jest.fn((value: Partial<Payment>) =>
    Object.assign(payment, value),
  );
  const paymentSave = jest.fn((value: Payment) => Promise.resolve(value));
  const bookingSave = jest.fn((value: Booking) => Promise.resolve(value));
  const calendarDelete = jest.fn().mockResolvedValue({ affected: 1 });

  return {
    paymentCreate,
    paymentSave,
    bookingSave,
    calendarDelete,
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Booking) {
        return {
          createQueryBuilder: () => bookingQuery,
          save: bookingSave,
        };
      }
      if (entity === Payment) {
        return {
          findOne: jest.fn((options: { where: Record<string, unknown> }) =>
            Promise.resolve(options.where.id === payment.id ? payment : null),
          ),
          findOneBy: jest.fn((criteria: Record<string, unknown>) => {
            if ('id' in criteria) {
              return Promise.resolve(payment);
            }
            return Promise.resolve(options.existingPayment ?? null);
          }),
          exists: jest.fn(() =>
            Promise.resolve(options.pendingExists ?? false),
          ),
          create: paymentCreate,
          save: paymentSave,
          createQueryBuilder: (alias?: string) => {
            if (alias === undefined) {
              return mutationQuery;
            }
            if (alias === 'canonicalPayment') {
              return createLockedQuery(options.canonicalPayment ?? null);
            }
            return paymentQuery;
          },
        };
      }
      if (entity === PaymentRefund) {
        return {
          findOneBy: jest.fn((criteria: Record<string, unknown>) => {
            const key = criteria.idempotencyKey;
            return Promise.resolve(
              typeof key === 'string' && payment.refund?.idempotencyKey === key
                ? payment.refund
                : null,
            );
          }),
          create: jest.fn((value: Partial<PaymentRefund>) =>
            Object.assign(refundFixture(), value),
          ),
          save: jest.fn((value: PaymentRefund) => {
            payment.refund = value;
            return Promise.resolve(value);
          }),
        };
      }
      if (entity === RoomCalendar) {
        return { delete: calendarDelete };
      }
      throw new Error('Unexpected repository');
    }),
  } as unknown as MutationManager;
}

function runTransaction(manager: EntityManager) {
  return (work: (entityManager: EntityManager) => unknown) =>
    Promise.resolve(work(manager));
}

function getRecordedAuditInputs(record: jest.Mock): AuditLogInput[] {
  return (record.mock.calls as unknown[][]).map(
    ([, input]) => input as AuditLogInput,
  );
}

function createLockedQuery<T>(result: T) {
  return {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
  };
}

function createPaymentQuery(result: Payment | undefined) {
  return {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result ?? null),
    getMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  } as unknown as SelectQueryBuilder<Payment> & {
    getMany: jest.Mock;
    getOne: jest.Mock;
  };
}

function createMutationQuery() {
  return {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
  };
}

function mockValidCallback(
  gateway: { verifyPaymentCallback: jest.Mock },
  overrides: Record<string, string> = {},
): void {
  const payDate = overrides.vnp_PayDate ?? '20300101070000';
  const paidAt =
    payDate === '20300101070000' ? new Date('2030-01-01T00:00:00.000Z') : null;

  gateway.verifyPaymentCallback.mockReturnValue({
    isValid: true,
    merchantCode: 'TEST_TMN',
    gatewayReference: overrides.vnp_TxnRef ?? 'P500',
    gatewayAmount: overrides.vnp_Amount ?? '200000000',
    providerResponseCode: overrides.vnp_ResponseCode ?? '00',
    providerTransactionStatus: overrides.vnp_TransactionStatus ?? '00',
    providerTransactionId: overrides.vnp_TransactionNo ?? '123456',
    paidAt,
  });
}

function bookingFixture(overrides: Partial<Booking> = {}): Booking {
  return {
    id: '100',
    bookingCode: 'BK100',
    customerId: '10',
    roomId: '1',
    createdByUserId: null,
    checkInDate: '2030-02-01',
    checkOutDate: '2030-02-03',
    guestCount: 2,
    contactName: 'Customer',
    contactPhone: '+84901234567',
    contactEmail: 'customer@example.com',
    totalAmount: '2000000.00',
    status: BookingStatus.PENDING_PAYMENT,
    paymentStatus: BookingPaymentStatus.UNPAID,
    acceptedPaymentId: null,
    paymentExpiresAt: new Date('2030-01-01T00:15:00.000Z'),
    customerNote: null,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: new Date('2030-01-01T00:00:00.000Z'),
    updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    ...overrides,
  } as Booking;
}

function paymentFixture(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '500',
    bookingId: '100',
    amount: '2000000.00',
    currency: 'VND',
    method: PaymentMethod.CASH,
    status: PaymentStatus.SUCCESS,
    reviewReason: null,
    reviewCanonicalPaymentId: null,
    gatewayName: null,
    gatewayReference: null,
    gatewayTransactionId: null,
    gatewayPaymentUrl: null,
    gatewayResponseCode: null,
    gatewayTransactionStatus: null,
    gatewayTransactionDate: null,
    idempotencyKey: null,
    refund: null,
    createdByUserId: null,
    createdByUser: null,
    paidAt: null,
    expiresAt: null,
    createdAt: new Date('2030-01-01T00:00:00.000Z'),
    updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    ...overrides,
  } as Payment;
}

function refundableVnPayPayment(overrides: Partial<Payment> = {}): Payment {
  return paymentFixture({
    method: PaymentMethod.VNPAY,
    status: PaymentStatus.SUCCESS,
    gatewayName: 'VNPAY',
    gatewayReference: 'P500',
    gatewayTransactionId: '123456',
    gatewayTransactionDate: '20300101070000',
    ...overrides,
  });
}

function duplicateVnPayPayment(overrides: Partial<Payment> = {}): Payment {
  return refundableVnPayPayment({
    status: PaymentStatus.REQUIRES_REVIEW,
    reviewReason: PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT,
    reviewCanonicalPaymentId: '501',
    gatewayTransactionId: 'duplicate-transaction',
    ...overrides,
  });
}

function successfulRefundResult() {
  return {
    isVerified: true,
    isSuccess: true,
    providerResponseCode: '00',
    providerTransactionStatus: '00',
    providerTransactionId: '654321',
    providerTransactionType: '02',
    gatewayAmount: '2000000',
    responseId: 'RESP-1',
    message: 'Refund success',
  };
}

let currentRefundFixture: PaymentRefund | null = null;

function refundFixture(overrides: Partial<PaymentRefund> = {}): PaymentRefund {
  return {
    id: '900',
    paymentId: '500',
    payment: null,
    idempotencyKey: null,
    requestId: null,
    previousPaymentStatus: null,
    gatewayTransactionId: null,
    responseCode: null,
    transactionStatus: null,
    message: null,
    reason: null,
    refundedByUserId: null,
    refundedByUser: null,
    requestedAt: null,
    refundedAt: null,
    lastQueriedAt: null,
    createdAt: new Date('2030-01-01T00:00:00.000Z'),
    updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    ...overrides,
  } as PaymentRefund;
}
