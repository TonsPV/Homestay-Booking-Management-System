import { ConflictException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type {
  DataSource,
  EntityManager,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';

import { ErrorCode } from '../../common/http';
import {
  Booking,
  BookingPaymentStatus,
  BookingStatus,
} from '../booking/schema/booking.entity';
import { RoomCalendar } from '../booking/schema/room-calendar.entity';
import { PaymentService } from './payment.service';
import { PaymentCollectionService } from './payment-collection.service';
import { PaymentQueryService } from './payment-query.service';
import { PaymentManualService } from './payment-manual.service';
import { PaymentRefundService } from './payment-refund.service';
import { Payment, PaymentMethod, PaymentStatus } from './schema/payment.entity';
import type { VnPayGatewayService } from './vnpay-gateway.service';

describe('PaymentService characterization', () => {
  let dataSource: { transaction: jest.Mock };
  let paymentsRepository: {
    findOneBy: jest.Mock;
    createQueryBuilder: jest.Mock;
    update: jest.Mock;
  };
  let bookingsRepository: {
    findOneBy: jest.Mock;
    exists: jest.Mock;
  };
  let gateway: {
    createPaymentUrl: jest.Mock;
    verifyCallback: jest.Mock;
    getTmnCode: jest.Mock;
    refundFull: jest.Mock;
    queryTransaction: jest.Mock;
  };
  let service: PaymentService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    dataSource = { transaction: jest.fn() };
    paymentsRepository = {
      findOneBy: jest.fn(),
      createQueryBuilder: jest.fn(),
      update: jest.fn(),
    };
    bookingsRepository = {
      findOneBy: jest.fn(),
      exists: jest.fn(),
    };
    gateway = {
      createPaymentUrl: jest.fn(),
      verifyCallback: jest.fn(),
      getTmnCode: jest.fn(() => 'TEST_TMN'),
      refundFull: jest.fn(),
      queryTransaction: jest.fn(),
    };
    const config = { getOrThrow: jest.fn(() => 15) };

    const paymentQueryService = new PaymentQueryService(
      paymentsRepository as unknown as Repository<Payment>,
      bookingsRepository as unknown as Repository<Booking>,
    );
    const paymentCollectionService = new PaymentCollectionService(
      dataSource as unknown as DataSource,
      paymentsRepository as unknown as Repository<Payment>,
      paymentQueryService,
      config as unknown as ConfigService,
      gateway as unknown as VnPayGatewayService,
    );
    const paymentManualService = new PaymentManualService(
      dataSource as unknown as DataSource,
      paymentsRepository as unknown as Repository<Payment>,
      paymentQueryService,
      config as unknown as ConfigService,
    );
    const paymentRefundService = new PaymentRefundService(
      dataSource as unknown as DataSource,
      paymentsRepository as unknown as Repository<Payment>,
      paymentQueryService,
      gateway as unknown as VnPayGatewayService,
    );
    service = new PaymentService(
      paymentCollectionService,
      paymentManualService,
      paymentQueryService,
      paymentRefundService,
    );
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
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
    paymentsRepository.createQueryBuilder.mockReturnValue(
      createPaymentQuery(payment),
    );

    await expect(
      service.recordManualPayment('20', '100', 'manual-key-0001', {
        method: PaymentMethod.CASH,
      }),
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
    paymentsRepository.createQueryBuilder.mockReturnValue(
      createPaymentQuery(payment),
    );

    await service.recordManualPayment('20', '100', 'manual-key-0002', {
      method: PaymentMethod.BANK_TRANSFER,
    });

    expect(manager.paymentCreate).not.toHaveBeenCalled();
    expect(manager.bookingSave).not.toHaveBeenCalled();
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
    gateway.createPaymentUrl.mockReturnValue('https://vnpay.test/pay/P500');
    paymentsRepository.createQueryBuilder.mockReturnValue(
      createPaymentQuery(payment),
    );

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

    expect(gateway.createPaymentUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: booking.totalAmount,
        transactionReference: 'P500',
        expiresAt: booking.paymentExpiresAt,
      }),
    );
  });

  it('rejects an IPN with an invalid signature without touching the database', async () => {
    gateway.verifyCallback.mockReturnValue({
      isValid: false,
      parameters: {},
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
    paymentsRepository.findOneBy.mockResolvedValue(payment);

    await expect(service.handleVnPayIpn({})).resolves.toEqual({
      RspCode: '04',
      Message: 'Invalid amount',
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
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
    paymentsRepository.findOneBy.mockResolvedValue(payment);
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(service.handleVnPayIpn({})).resolves.toEqual({
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
    paymentsRepository.findOneBy.mockResolvedValue(payment);
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await expect(service.handleVnPayIpn({})).resolves.toEqual({
      RspCode: '00',
      Message: 'Confirm Success',
    });
    expect(payment.status).toBe(PaymentStatus.REQUIRES_REVIEW);
    expect(booking.status).toBe(BookingStatus.CANCELLED);
    expect(manager.bookingSave).not.toHaveBeenCalled();
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
    paymentsRepository.findOneBy.mockResolvedValue(payment);
    paymentsRepository.createQueryBuilder.mockReturnValue(
      createPaymentQuery(payment),
    );
    dataSource.transaction.mockImplementation(runTransaction(manager));

    await service.refund('20', '500', undefined, undefined, {
      reason: 'Guest cancelled',
    });

    expect(payment).toMatchObject({
      status: PaymentStatus.REFUNDED,
      refundedByUserId: '20',
      refundReason: 'Guest cancelled',
    });
    expect(booking).toMatchObject({
      status: BookingStatus.CANCELLED,
      paymentStatus: BookingPaymentStatus.REFUNDED,
    });
    expect(manager.calendarDelete).toHaveBeenCalledWith({ bookingId: '100' });
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
    paymentsRepository.findOneBy.mockResolvedValue(payment);
    paymentsRepository.createQueryBuilder.mockReturnValue(
      createPaymentQuery(payment),
    );
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.refundFull.mockRejectedValue(new Error('provider timeout'));

    await expect(
      service.refund('20', '500', 'refund-key-0001', '127.0.0.1', {
        reason: 'Guest cancelled',
      }),
    ).rejects.toHaveProperty(
      'response.errorCode',
      ErrorCode.PAYMENT_REFUND_OUTCOME_UNKNOWN,
    );

    expect(payment).toMatchObject({
      status: PaymentStatus.REFUND_PENDING,
      refundIdempotencyKey: 'refund-key-0001',
      refundPreviousStatus: PaymentStatus.SUCCESS,
    });
    expect(booking.paymentStatus).toBe(BookingPaymentStatus.PAID);
  });

  it('completes a verified VNPay refund and releases the booking calendar', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = refundableVnPayPayment();
    const manager = createMutationManager(booking, payment);
    paymentsRepository.findOneBy.mockResolvedValue(payment);
    paymentsRepository.createQueryBuilder.mockReturnValue(
      createPaymentQuery(payment),
    );
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.refundFull.mockResolvedValue(successfulRefundResult());

    await expect(
      service.refund('20', '500', 'refund-key-0002', '127.0.0.1', {
        reason: 'Guest cancelled',
      }),
    ).resolves.toMatchObject({
      id: '500',
      status: PaymentStatus.REFUNDED,
    });

    expect(booking).toMatchObject({
      status: BookingStatus.CANCELLED,
      paymentStatus: BookingPaymentStatus.REFUNDED,
    });
    expect(manager.calendarDelete).toHaveBeenCalledWith({ bookingId: '100' });
  });

  it('restores SUCCESS when VNPay explicitly rejects a refund', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = refundableVnPayPayment();
    const manager = createMutationManager(booking, payment);
    paymentsRepository.findOneBy.mockResolvedValue(payment);
    paymentsRepository.createQueryBuilder.mockReturnValue(
      createPaymentQuery(payment),
    );
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.refundFull.mockResolvedValue({
      ...successfulRefundResult(),
      isSuccess: false,
      responseCode: '24',
      transactionStatus: '02',
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
    paymentsRepository.findOneBy.mockResolvedValue(payment);
    paymentsRepository.createQueryBuilder.mockReturnValue(
      createPaymentQuery(payment),
    );
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.refundFull.mockResolvedValue({
      ...successfulRefundResult(),
      isVerified: false,
      isSuccess: false,
      responseCode: '99',
      transactionStatus: '05',
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
    expect(booking.paymentStatus).toBe(BookingPaymentStatus.PAID);
  });

  it('reconciles a pending VNPay refund without sending another refund mutation', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const payment = refundableVnPayPayment({
      status: PaymentStatus.REFUND_PENDING,
      refundIdempotencyKey: 'refund-key-0005',
      refundRequestId: 'R123',
      refundPreviousStatus: PaymentStatus.SUCCESS,
      refundReason: 'Guest cancelled',
      refundedByUserId: '20',
    });
    const manager = createMutationManager(booking, payment);
    paymentsRepository.createQueryBuilder.mockReturnValue(
      createPaymentQuery(payment),
    );
    dataSource.transaction.mockImplementation(runTransaction(manager));
    gateway.queryTransaction.mockResolvedValue(successfulRefundResult());

    await expect(
      service.reconcileVnPayRefund('20', '500', '127.0.0.1'),
    ).resolves.toMatchObject({
      id: '500',
      status: PaymentStatus.REFUNDED,
    });

    expect(gateway.refundFull).not.toHaveBeenCalled();
    expect(gateway.queryTransaction).toHaveBeenCalledTimes(1);
    expect(booking.paymentStatus).toBe(BookingPaymentStatus.REFUNDED);
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
  options: { existingPayment?: Payment | null; pendingExists?: boolean } = {},
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
          findOneBy: jest.fn((criteria: Record<string, unknown>) => {
            if ('refundIdempotencyKey' in criteria) {
              return Promise.resolve(null);
            }
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
          createQueryBuilder: (alias?: string) =>
            alias === undefined ? mutationQuery : paymentQuery,
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

function createLockedQuery<T>(result: T) {
  return {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
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
  gateway: { verifyCallback: jest.Mock },
  overrides: Record<string, string> = {},
): void {
  gateway.verifyCallback.mockReturnValue({
    isValid: true,
    parameters: {
      vnp_TmnCode: 'TEST_TMN',
      vnp_TxnRef: 'P500',
      vnp_Amount: '200000000',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: '123456',
      vnp_PayDate: '20300101070000',
      ...overrides,
    },
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
    gatewayName: null,
    gatewayReference: null,
    gatewayTransactionId: null,
    gatewayPaymentUrl: null,
    gatewayResponseCode: null,
    gatewayTransactionStatus: null,
    gatewayTransactionDate: null,
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
    createdByUser: null,
    refundedByUserId: null,
    refundedByUser: null,
    paidAt: null,
    refundedAt: null,
    refundRequestedAt: null,
    refundLastQueriedAt: null,
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

function successfulRefundResult() {
  return {
    isVerified: true,
    isSuccess: true,
    responseCode: '00',
    transactionStatus: '00',
    transactionId: '654321',
    transactionType: '02',
    amount: '2000000',
    responseId: 'RESP-1',
    message: 'Refund success',
  };
}
