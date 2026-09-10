import { HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { ErrorCode } from '../../../../src/common/error-codes';
import type { TransactionContext } from '../../../../src/common/database/transaction';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../../../../src/module/audit/domain/audit-log';
import type { AuditLogInput } from '../../../../src/module/audit/audit-log.service';
import { BookingPaymentLifecycleService } from '../../../../src/module/booking/booking-payment-lifecycle.service';
import { BookingTransitionPolicy } from '../../../../src/module/booking/domain/booking-transition.policy';
import {
  BookingPaymentStatus,
  BookingStatus,
} from '../../../../src/module/booking/domain/booking-state';
import type { BookingLifecycleStore } from '../../../../src/module/booking/ports/booking-lifecycle.store';
import type { RoomCalendarStore } from '../../../../src/module/booking/ports/room-calendar.store';
import type { Booking } from '../../../../src/module/booking/schema/booking.entity';
import {
  PaymentReviewReason,
  PaymentStatus,
} from '../../../../src/module/payment/domain/payment-state';
import type { PaymentAcceptanceStore } from '../../../../src/module/payment/ports/payment-acceptance.store';
import type { PaymentRefundStore } from '../../../../src/module/payment/ports/payment-refund.store';
import type { Payment } from '../../../../src/module/payment/schema/payment.entity';
import type { PaymentRefund } from '../../../../src/module/payment/schema/payment-refund.entity';

describe('BookingPaymentLifecycleService', () => {
  let bookingStore: {
    findExpiredForUpdate: jest.Mock;
    saveState: jest.Mock;
  };
  let paymentStateStore: {
    failPendingOnlinePayments: jest.Mock;
    hasPendingRefund: jest.Mock;
  };
  let calendarStore: {
    releaseBookingReservation: jest.Mock;
    releaseBookingReservations: jest.Mock;
  };
  let paymentAcceptanceStore: {
    savePaymentState: jest.Mock;
    saveBookingState: jest.Mock;
  };
  let paymentRefundStore: {
    savePaymentState: jest.Mock;
    saveRefundState: jest.Mock;
    saveBookingState: jest.Mock;
  };
  let auditLog: { record: jest.Mock };
  let recordedContexts: TransactionContext[];
  let lifecycle: BookingPaymentLifecycleService;

  const context = {} as TransactionContext;

  beforeEach(() => {
    recordedContexts = [];
    bookingStore = {
      findExpiredForUpdate: jest.fn().mockResolvedValue([]),
      saveState: jest.fn().mockResolvedValue(undefined),
    };
    paymentStateStore = {
      failPendingOnlinePayments: jest.fn().mockResolvedValue(undefined),
      hasPendingRefund: jest.fn().mockResolvedValue(false),
    };
    calendarStore = {
      releaseBookingReservation: jest.fn().mockResolvedValue(undefined),
      releaseBookingReservations: jest.fn().mockResolvedValue(undefined),
    };
    paymentAcceptanceStore = {
      savePaymentState: jest.fn().mockResolvedValue(undefined),
      saveBookingState: jest.fn().mockResolvedValue(undefined),
    };
    paymentRefundStore = {
      savePaymentState: jest.fn().mockResolvedValue(undefined),
      saveRefundState: jest.fn().mockResolvedValue(undefined),
      saveBookingState: jest.fn().mockResolvedValue(undefined),
    };
    auditLog = {
      record: jest.fn((ctx: TransactionContext) => {
        recordedContexts.push(ctx);
        return Promise.resolve();
      }),
    };
    lifecycle = new BookingPaymentLifecycleService(
      {
        run: <T>(work: (ctx: TransactionContext) => Promise<T>) =>
          work(context),
      },
      {
        getOrThrow: () => 15,
      } as unknown as ConfigService,
      new BookingTransitionPolicy(),
      bookingStore as unknown as BookingLifecycleStore,
      paymentStateStore,
      calendarStore as unknown as RoomCalendarStore,
      auditLog,
      paymentAcceptanceStore as unknown as PaymentAcceptanceStore,
      paymentRefundStore as unknown as PaymentRefundStore,
    );
  });

  describe('acceptPayment (manual)', () => {
    it('confirms a pending booking and marks it paid', async () => {
      const booking = bookingFixture();
      const payment = paymentFixture({ createdByUserId: '20' });

      await lifecycle.applyAcceptedManualPayment(context, {
        booking,
        payment,
        bookingFromStatus: BookingStatus.PENDING_PAYMENT,
        requestId: 'request-manual',
      });

      expect(booking).toMatchObject({
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.PAID,
        paymentExpiresAt: null,
        acceptedPaymentId: '500',
      });
      expect(bookingStore.saveState).toHaveBeenCalledWith(context, booking);
      expect(auditLog.record).toHaveBeenCalledTimes(2);
      expect(auditLog.record).toHaveBeenNthCalledWith(
        1,
        context,
        expect.objectContaining({
          actorType: AuditActorType.USER,
          actorId: '20',
          action: AuditAction.PAYMENT_CONFIRMED,
          entityType: AuditEntityType.PAYMENT,
          entityId: '500',
        }),
      );
      expect(auditLog.record).toHaveBeenNthCalledWith(
        2,
        context,
        expect.objectContaining({
          action: AuditAction.BOOKING_STATUS_CHANGED,
          entityId: '100',
        }),
      );
      const [, statusChangeInput] = (
        auditLog.record.mock.calls as Array<[TransactionContext, AuditLogInput]>
      )[1];
      expect(statusChangeInput.metadata).toMatchObject({
        fromStatus: BookingStatus.PENDING_PAYMENT,
        toStatus: BookingStatus.CONFIRMED,
      });
    });

    it('keeps an already confirmed booking confirmed without a status-change audit', async () => {
      const booking = bookingFixture({
        status: BookingStatus.CONFIRMED,
      });
      const payment = paymentFixture({ createdByUserId: '20' });

      await lifecycle.applyAcceptedManualPayment(context, {
        booking,
        payment,
        bookingFromStatus: BookingStatus.CONFIRMED,
      });

      expect(booking.status).toBe(BookingStatus.CONFIRMED);
      expect(booking.paymentStatus).toBe(BookingPaymentStatus.PAID);
      expect(auditLog.record).toHaveBeenCalledTimes(1);
      expect(auditLog.record).toHaveBeenCalledWith(
        context,
        expect.objectContaining({ action: AuditAction.PAYMENT_CONFIRMED }),
      );
    });
  });

  describe('applyGatewayPaymentOutcome', () => {
    it('confirms the booking when the gateway reports success', async () => {
      const booking = bookingFixture();
      const payment = paymentFixture({ method: 'VNPAY' as never });

      const result = await lifecycle.applyGatewayPaymentOutcome(context, {
        booking,
        payment,
        canonicalPaymentId: null,
        transactionId: '123456',
        paidAt: new Date('2030-01-01T00:00:00.000Z'),
      });

      expect(result).toEqual({
        outcome: 'PROCESSED',
        reviewReason: null,
      });
      expect(payment.status).toBe(PaymentStatus.SUCCESS);
      expect(booking).toMatchObject({
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.PAID,
        acceptedPaymentId: '500',
      });
      expect(paymentAcceptanceStore.savePaymentState).toHaveBeenCalled();
      expect(paymentAcceptanceStore.saveBookingState).toHaveBeenCalled();
    });

    it('marks a success for a cancelled booking as REQUIRES_REVIEW', async () => {
      const booking = bookingFixture({ status: BookingStatus.CANCELLED });
      const payment = paymentFixture({
        method: 'VNPAY' as never,
        status: PaymentStatus.FAILED,
      });

      const result = await lifecycle.applyGatewayPaymentOutcome(context, {
        booking,
        payment,
        canonicalPaymentId: null,
        transactionId: '123456',
        paidAt: null,
      });

      expect(result.outcome).toBe('REQUIRES_REVIEW');
      expect(result.reviewReason).toBe(PaymentReviewReason.BOOKING_CANCELLED);
      expect(payment.status).toBe(PaymentStatus.REQUIRES_REVIEW);
      expect(booking.status).toBe(BookingStatus.CANCELLED);
      expect(paymentAcceptanceStore.saveBookingState).not.toHaveBeenCalled();
      const reviewAuditInputs = (
        auditLog.record.mock.calls as Array<[TransactionContext, AuditLogInput]>
      ).map(([, input]) => input);
      expect(
        reviewAuditInputs.some(
          (input) =>
            input.metadata !== null &&
            input.metadata?.reviewReason ===
              PaymentReviewReason.BOOKING_CANCELLED,
        ),
      ).toBe(true);
    });

    it('marks a second successful payment as ANOTHER_SUCCESSFUL_PAYMENT', async () => {
      const booking = bookingFixture({
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.PAID,
        acceptedPaymentId: '501',
      });
      const payment = paymentFixture({
        method: 'VNPAY' as never,
        status: PaymentStatus.PENDING,
      });

      const result = await lifecycle.applyGatewayPaymentOutcome(context, {
        booking,
        payment,
        canonicalPaymentId: null,
        transactionId: '123456',
        paidAt: null,
      });

      expect(result.outcome).toBe('REQUIRES_REVIEW');
      expect(result.reviewReason).toBe(
        PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT,
      );
      expect(payment.reviewCanonicalPaymentId).toBe('501');
      expect(booking.acceptedPaymentId).toBe('501');
    });
  });

  describe('completeRefund', () => {
    it('refunds the payment, cancels the booking and releases the calendar', async () => {
      const booking = bookingFixture({ status: BookingStatus.CONFIRMED });
      const payment = paymentFixture({
        method: 'VNPAY' as never,
        status: PaymentStatus.SUCCESS,
        refund: refundFixture({ reason: 'Guest cancelled' }),
      });

      await lifecycle.completeRefund(context, booking, payment, '20', 'req-1');

      expect(payment.status).toBe(PaymentStatus.REFUNDED);
      expect(booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        paymentStatus: BookingPaymentStatus.REFUNDED,
      });
      expect(paymentRefundStore.savePaymentState).toHaveBeenCalled();
      expect(paymentRefundStore.saveBookingState).toHaveBeenCalled();
      expect(calendarStore.releaseBookingReservation).toHaveBeenCalledWith(
        context,
        '100',
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        context,
        expect.objectContaining({ action: AuditAction.REFUND_COMPLETED }),
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        context,
        expect.objectContaining({ action: AuditAction.BOOKING_CANCELLED }),
      );
    });

    it('does not duplicate BOOKING_CANCELLED for an already cancelled booking', async () => {
      const booking = bookingFixture({ status: BookingStatus.CANCELLED });
      const payment = paymentFixture({
        method: 'VNPAY' as never,
        status: PaymentStatus.SUCCESS,
        refund: refundFixture(),
      });

      await lifecycle.completeRefund(context, booking, payment, '20');

      expect(booking.status).toBe(BookingStatus.CANCELLED);
      expect(payment.status).toBe(PaymentStatus.REFUNDED);
      const actions = (
        auditLog.record.mock.calls as Array<
          [TransactionContext, { action: AuditAction }]
        >
      ).map(([, input]) => input.action);
      expect(actions).toContain(AuditAction.REFUND_COMPLETED);
      expect(actions).not.toContain(AuditAction.BOOKING_CANCELLED);
    });

    it('refunds a duplicate charge without cancelling the paid booking', async () => {
      const booking = bookingFixture({
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.PAID,
      });
      const payment = paymentFixture({
        method: 'VNPAY' as never,
        status: PaymentStatus.REQUIRES_REVIEW,
        refund: refundFixture({
          previousPaymentStatus: PaymentStatus.REQUIRES_REVIEW,
          requestId: 'R1',
        }),
        reviewReason: PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT,
        reviewCanonicalPaymentId: '501',
      });

      await lifecycle.completeRefund(context, booking, payment, '20');

      expect(payment.status).toBe(PaymentStatus.REFUNDED);
      expect(booking).toMatchObject({
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.PAID,
      });
      expect(paymentRefundStore.saveBookingState).not.toHaveBeenCalled();
      expect(calendarStore.releaseBookingReservation).not.toHaveBeenCalled();
      const refundAuditInputs = (
        auditLog.record.mock.calls as Array<[TransactionContext, AuditLogInput]>
      ).map(([, input]) => input);
      expect(
        refundAuditInputs.some(
          (input) =>
            input.metadata !== null &&
            input.metadata?.canonicalPaymentId === '501' &&
            input.metadata?.duplicatePaymentId === '500',
        ),
      ).toBe(true);
    });
  });

  describe('cancelBooking', () => {
    it('refuses to cancel a paid booking', async () => {
      const booking = bookingFixture({
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.PAID,
      });

      await expect(
        lifecycle.cancelBooking(context, booking, 'Changed plans', true),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: { errorCode: ErrorCode.BOOKING_CANCELLATION_ALREADY_PAID },
      });
      expect(bookingStore.saveState).not.toHaveBeenCalled();
    });

    it('cancels an unpaid booking and fails its pending online payments', async () => {
      const booking = bookingFixture();
      const changed = await lifecycle.cancelBooking(
        context,
        booking,
        'Changed plans',
        true,
      );

      expect(changed).toBe(true);
      expect(booking.status).toBe(BookingStatus.CANCELLED);
      expect(paymentStateStore.failPendingOnlinePayments).toHaveBeenCalledWith(
        context,
        ['100'],
        'CANCELLED',
      );
      expect(calendarStore.releaseBookingReservation).toHaveBeenCalledWith(
        context,
        '100',
      );
    });

    it('is a no-op for an already cancelled booking', async () => {
      const booking = bookingFixture({ status: BookingStatus.CANCELLED });

      await expect(
        lifecycle.cancelBooking(context, booking, 'Again', true),
      ).resolves.toBe(false);
      expect(bookingStore.saveState).not.toHaveBeenCalled();
      expect(
        paymentStateStore.failPendingOnlinePayments,
      ).not.toHaveBeenCalled();
      expect(calendarStore.releaseBookingReservation).not.toHaveBeenCalled();
    });
  });

  describe('expireUnpaidBookings', () => {
    it('expires the locked unpaid batch with payments and calendars in one transaction', async () => {
      const now = new Date('2030-01-01T01:00:00.000Z');
      const expired = [bookingFixture(), bookingFixture({ id: '101' })];
      bookingStore.findExpiredForUpdate.mockResolvedValue(expired);

      await expect(lifecycle.expireUnpaidBookings(now)).resolves.toBe(2);

      expect(expired).toEqual([
        expect.objectContaining({ status: BookingStatus.CANCELLED }),
        expect.objectContaining({ status: BookingStatus.CANCELLED }),
      ]);
      expect(paymentStateStore.failPendingOnlinePayments).toHaveBeenCalledWith(
        context,
        ['100', '101'],
        'EXPIRED',
      );
      expect(calendarStore.releaseBookingReservations).toHaveBeenCalledWith(
        context,
        ['100', '101'],
      );
      expect(auditLog.record).toHaveBeenCalledTimes(2);
      for (const ctx of recordedContexts) {
        expect(ctx).toBe(context);
      }
    });

    it('does nothing when no booking has expired', async () => {
      await expect(lifecycle.expireUnpaidBookings()).resolves.toBe(0);
      expect(bookingStore.saveState).not.toHaveBeenCalled();
      expect(
        paymentStateStore.failPendingOnlinePayments,
      ).not.toHaveBeenCalled();
      expect(calendarStore.releaseBookingReservations).not.toHaveBeenCalled();
    });
  });
});

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
    contactPhone: '+849****4567',
    contactEmail: null,
    totalAmount: '2000000.00',
    status: BookingStatus.PENDING_PAYMENT,
    paymentStatus: BookingPaymentStatus.UNPAID,
    acceptedPaymentId: null,
    paymentExpiresAt: new Date('2030-01-01T00:15:00.000Z'),
    customerNote: null,
    cancelledAt: null,
    cancellationReason: null,
    requestIntentActorType: null,
    requestIntentActorId: null,
    requestIntentKey: null,
    requestIntentHash: null,
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
    method: 'CASH' as never,
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
