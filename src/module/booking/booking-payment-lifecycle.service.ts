import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  type TransactionContext,
  TransactionRunner,
} from '../../common/application/transaction';
import { ErrorCode } from '../../common/error-codes';
import { AppHttpException } from '../../common/http/app-http-exception';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../audit/domain/audit-log';
import { TransactionalAuditLog } from '../audit/ports/transactional-audit-log';
import {
  PaymentReviewReason,
  PaymentStatus,
} from '../payment/domain/payment-state';
import { detectDuplicateChargeRefund } from '../payment/domain/duplicate-charge.detector';
import { buildRefundAuditMetadata } from '../payment/infrastructure/mapper/payment-refund.mapper';
import { PaymentAcceptanceStore } from '../payment/ports/payment-acceptance.store';
import { PaymentRefundStore } from '../payment/ports/payment-refund.store';
import { Payment } from '../payment/schema/payment.entity';
import { BookingTransitionPolicy } from './domain/booking-transition.policy';
import { BookingPaymentStatus, BookingStatus } from './domain/booking-state';
import {
  BookingLifecycleStore,
  BookingPaymentStateStore,
} from './ports/booking-lifecycle.store';
import { RoomCalendarStore } from './ports/room-calendar.store';
import { Booking } from './schema/booking.entity';

/**
 * Owns every cross-aggregate lifecycle transition between
 * Booking, Payment and Room Calendar:
 *
 *   - unpaid-booking expiry (booking + pending online payments + calendar release)
 *   - booking cancellation (booking + pending online payments + calendar release)
 *   - payment acceptance side effects (manual + gateway/IPN result -> booking state)
 *   - refund completion (payment + booking + calendar release)
 *
 * Callers lock the aggregates they already resolved inside their own
 * transaction and pass them in; the coordinator never acquires new locks,
 * so the documented lock order stays unchanged. All persistence goes
 * through the Phase 2 semantic stores and all transition validity stays
 * with the domain policies (BookingTransitionPolicy) — the coordinator
 * only orchestrates. Gateway communication, idempotency decisions,
 * eligibility checks and audit formatting stay with the calling services.
 */
@Injectable()
export class BookingPaymentLifecycleService {
  private readonly paymentTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionRunner,
    configService: ConfigService,
    private readonly transitionPolicy: BookingTransitionPolicy,
    private readonly bookings: BookingLifecycleStore,
    private readonly payments: BookingPaymentStateStore,
    private readonly roomCalendar: RoomCalendarStore,
    private readonly auditLog: TransactionalAuditLog,
    private readonly paymentAcceptance: PaymentAcceptanceStore,
    private readonly paymentRefunds: PaymentRefundStore,
  ) {
    this.paymentTimeoutMs =
      configService.getOrThrow<number>('BOOKING_PAYMENT_TIMEOUT_MINUTES') *
      60 *
      1000;
  }

  /**
   * Expires every unpaid booking whose payment deadline has passed.
   * Owns its transaction: one batch = one transaction.
   */
  async expireUnpaidBookings(now = new Date()): Promise<number> {
    return this.transactions.run(async (transaction) => {
      const legacyCutoff = new Date(now.getTime() - this.paymentTimeoutMs);
      const expiredBookings = await this.bookings.findExpiredForUpdate(
        transaction,
        now,
        legacyCutoff,
        100,
      );

      if (expiredBookings.length === 0) {
        return 0;
      }

      const bookingIds = expiredBookings.map((booking) => booking.id);

      for (const booking of expiredBookings) {
        booking.status = BookingStatus.CANCELLED;
        booking.paymentExpiresAt = null;
        booking.cancelledAt = now;
        booking.cancellationReason = 'Thanh toán đã hết hạn.';
      }

      await this.bookings.saveState(transaction, expiredBookings);
      await this.payments.failPendingOnlinePayments(
        transaction,
        bookingIds,
        'EXPIRED',
      );
      await this.roomCalendar.releaseBookingReservations(
        transaction,
        bookingIds,
      );

      for (const booking of expiredBookings) {
        await this.recordStatusAudit(
          transaction,
          booking,
          AuditAction.BOOKING_CANCELLED,
          AuditActorType.SYSTEM,
          null,
          BookingStatus.PENDING_PAYMENT,
        );
      }

      return expiredBookings.length;
    });
  }

  /**
   * Cancels a locked booking, fails its pending online payments and
   * releases its calendar reservation. Must be called inside the
   * caller's transaction with the booking already locked.
   */
  async cancelBooking(
    context: TransactionContext,
    booking: Booking,
    reason: string | null,
    customerRequested: boolean,
  ): Promise<boolean> {
    if (booking.status === BookingStatus.CANCELLED) {
      return false;
    }

    if (booking.paymentStatus === BookingPaymentStatus.PAID) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_CANCELLATION_ALREADY_PAID,
        'Booking da thanh toan. Can hoan tien truoc khi huy.',
      );
    }

    if (
      customerRequested &&
      booking.status !== BookingStatus.PENDING_PAYMENT &&
      booking.status !== BookingStatus.CONFIRMED
    ) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_CANCELLATION_NOT_ALLOWED,
        'Customer khong the huy booking o trang thai hien tai.',
      );
    }

    if (
      !customerRequested &&
      !this.transitionPolicy.evaluate(booking, BookingStatus.CANCELLED).allowed
    ) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_CANCELLATION_NOT_ALLOWED,
        `Khong the huy booking o trang thai ${booking.status}.`,
      );
    }

    booking.status = BookingStatus.CANCELLED;
    booking.paymentExpiresAt = null;
    booking.cancelledAt = new Date();
    booking.cancellationReason = reason;

    await this.bookings.saveState(context, booking);
    await this.payments.failPendingOnlinePayments(
      context,
      [booking.id],
      'CANCELLED',
    );
    await this.roomCalendar.releaseBookingReservation(context, booking.id);

    return true;
  }

  /**
   * Applies the booking side effects of an accepted manual payment:
   * marks the booking paid/confirmed and records the confirmation and
   * (if the booking status changed) the status-change audits. The
   * payment row itself is created by the caller beforehand.
   */
  async applyAcceptedManualPayment(
    context: TransactionContext,
    input: {
      booking: Booking;
      payment: Payment;
      bookingFromStatus: BookingStatus;
      requestId?: string;
    },
  ): Promise<void> {
    const { booking, payment, bookingFromStatus } = input;

    booking.paymentStatus = BookingPaymentStatus.PAID;
    booking.acceptedPaymentId = payment.id;
    booking.paymentExpiresAt = null;

    if (booking.status === BookingStatus.PENDING_PAYMENT) {
      booking.status = BookingStatus.CONFIRMED;
    }

    await this.bookings.saveState(context, booking);
    await this.auditLog.record(context, {
      actorType: AuditActorType.USER,
      actorId: payment.createdByUserId,
      action: AuditAction.PAYMENT_CONFIRMED,
      entityType: AuditEntityType.PAYMENT,
      entityId: payment.id,
      requestId: input.requestId,
      metadata: {
        bookingId: booking.id,
        method: payment.method,
      },
    });
    if (bookingFromStatus !== booking.status) {
      await this.auditLog.record(context, {
        actorType: AuditActorType.USER,
        actorId: payment.createdByUserId,
        action: AuditAction.BOOKING_STATUS_CHANGED,
        entityType: AuditEntityType.BOOKING,
        entityId: booking.id,
        requestId: input.requestId,
        metadata: {
          fromStatus: bookingFromStatus,
          toStatus: booking.status,
          paymentId: payment.id,
        },
      });
    }
  }

  /**
   * Applies a verified gateway (IPN) payment outcome to the payment and
   * the booking. Success confirms the booking unless another payment
   * already succeeded or the booking was cancelled — those become
   * REQUIRES_REVIEW with the existing review reason. The duplicate /
   * already-processed decisions stay with the caller (PaymentCollection).
   */
  async applyGatewayPaymentOutcome(
    context: TransactionContext,
    input: {
      booking: Booking;
      payment: Payment;
      canonicalPaymentId: string | null;
      transactionId: string;
      paidAt: Date | null;
      requestId?: string;
    },
  ): Promise<{
    outcome: 'PROCESSED' | 'REQUIRES_REVIEW';
    reviewReason: PaymentReviewReason | null;
  }> {
    const { booking, payment } = input;
    const bookingFromStatus = booking.status;
    const canonicalPaymentId =
      booking.acceptedPaymentId ?? input.canonicalPaymentId;

    if (
      booking.status === BookingStatus.CANCELLED ||
      (canonicalPaymentId !== null && canonicalPaymentId !== payment.id)
    ) {
      const reviewReason =
        booking.status === BookingStatus.CANCELLED
          ? PaymentReviewReason.BOOKING_CANCELLED
          : PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT;
      payment.status = PaymentStatus.REQUIRES_REVIEW;
      payment.reviewReason = reviewReason;
      payment.reviewCanonicalPaymentId =
        reviewReason === PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT
          ? canonicalPaymentId
          : null;
      payment.gatewayTransactionId = input.transactionId;
      payment.paidAt = input.paidAt;
      await this.paymentAcceptance.savePaymentState(context, payment);
      await this.auditLog.record(context, {
        actorType: AuditActorType.SYSTEM,
        actorId: null,
        action: AuditAction.PAYMENT_CONFIRMED,
        entityType: AuditEntityType.PAYMENT,
        entityId: payment.id,
        requestId: input.requestId,
        metadata: {
          bookingId: booking.id,
          source: 'IPN',
          paymentStatus: payment.status,
          reviewReason: reviewReason ?? 'UNKNOWN',
        },
      });

      return { outcome: 'REQUIRES_REVIEW', reviewReason };
    }

    payment.status = PaymentStatus.SUCCESS;
    payment.reviewReason = null;
    payment.reviewCanonicalPaymentId = null;
    payment.gatewayTransactionId = input.transactionId;
    payment.paidAt = input.paidAt;
    booking.acceptedPaymentId = payment.id;

    booking.paymentStatus = BookingPaymentStatus.PAID;
    booking.paymentExpiresAt = null;

    if (booking.status === BookingStatus.PENDING_PAYMENT) {
      booking.status = BookingStatus.CONFIRMED;
    }

    await this.paymentAcceptance.savePaymentState(context, payment);
    await this.paymentAcceptance.saveBookingState(context, booking);

    await this.auditLog.record(context, {
      actorType: AuditActorType.SYSTEM,
      actorId: null,
      action: AuditAction.PAYMENT_CONFIRMED,
      entityType: AuditEntityType.PAYMENT,
      entityId: payment.id,
      requestId: input.requestId,
      metadata: {
        bookingId: booking.id,
        source: 'IPN',
        paymentStatus: payment.status,
      },
    });
    if (bookingFromStatus !== booking.status) {
      await this.auditLog.record(context, {
        actorType: AuditActorType.SYSTEM,
        actorId: null,
        action: AuditAction.BOOKING_STATUS_CHANGED,
        entityType: AuditEntityType.BOOKING,
        entityId: booking.id,
        requestId: input.requestId,
        metadata: {
          fromStatus: bookingFromStatus,
          toStatus: booking.status,
          paymentId: payment.id,
        },
      });
    }

    return { outcome: 'PROCESSED', reviewReason: null };
  }

  /**
   * Completes a refund atomically: marks the payment refunded, cancels /
   * unpaids the booking and releases its calendar reservation. Duplicate
   * charge refunds keep the booking untouched. Must be called inside the
   * caller's transaction with payment and booking already locked.
   */
  async completeRefund(
    context: TransactionContext,
    booking: Booking,
    payment: Payment,
    actorId: string,
    requestId?: string,
  ): Promise<void> {
    const now = new Date();
    const refund = payment.refund;

    if (refund === null || refund === undefined) {
      throw new Error(
        `Payment ${payment.id} is missing its payment refund record.`,
      );
    }

    if (detectDuplicateChargeRefund(payment, booking.id).isDuplicateCharge) {
      payment.status = PaymentStatus.REFUNDED;
      refund.refundedAt = now;
      await this.paymentRefunds.saveRefundState(context, refund);
      await this.paymentRefunds.savePaymentState(context, payment);
      await this.auditLog.record(context, {
        actorType: AuditActorType.USER,
        actorId,
        action: AuditAction.REFUND_COMPLETED,
        entityType: AuditEntityType.PAYMENT,
        entityId: payment.id,
        requestId,
        metadata: buildRefundAuditMetadata(booking, payment),
      });
      return;
    }

    const bookingFromStatus = booking.status;

    payment.status = PaymentStatus.REFUNDED;
    refund.refundedAt = now;
    booking.paymentStatus = BookingPaymentStatus.REFUNDED;
    booking.paymentExpiresAt = null;

    if (booking.status !== BookingStatus.CANCELLED) {
      booking.status = BookingStatus.CANCELLED;
      booking.cancelledAt = now;
      booking.cancellationReason = refund.reason ?? 'Hoàn tiền theo yêu cầu.';
    }

    await this.paymentRefunds.saveRefundState(context, refund);
    await this.paymentRefunds.savePaymentState(context, payment);
    await this.paymentRefunds.saveBookingState(context, booking);
    await this.roomCalendar.releaseBookingReservation(context, booking.id);
    await this.auditLog.record(context, {
      actorType: AuditActorType.USER,
      actorId,
      action: AuditAction.REFUND_COMPLETED,
      entityType: AuditEntityType.PAYMENT,
      entityId: payment.id,
      requestId,
      metadata: buildRefundAuditMetadata(booking, payment),
    });
    if (bookingFromStatus !== booking.status) {
      await this.auditLog.record(context, {
        actorType: AuditActorType.USER,
        actorId,
        action: AuditAction.BOOKING_CANCELLED,
        entityType: AuditEntityType.BOOKING,
        entityId: booking.id,
        requestId,
        metadata: {
          fromStatus: bookingFromStatus,
          toStatus: booking.status,
          paymentId: payment.id,
        },
      });
    }
  }

  private async recordStatusAudit(
    context: TransactionContext,
    booking: Booking,
    action: AuditAction,
    actorType: AuditActorType,
    actorId: string | null,
    fromStatus: BookingStatus,
    requestId?: string,
  ): Promise<void> {
    await this.auditLog.record(context, {
      actorType,
      actorId,
      action,
      entityType: AuditEntityType.BOOKING,
      entityId: booking.id,
      requestId,
      metadata: {
        fromStatus,
        toStatus: booking.status,
        cancellationReason: booking.cancellationReason,
      },
    });
  }
}
