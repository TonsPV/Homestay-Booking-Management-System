import type { TransactionContext } from '../../../common/application/transaction';
import type { Booking } from '../../booking/schema/booking.entity';
import { PaymentStatus } from '../domain/payment-state';
import type { Payment } from '../schema/payment.entity';
import type { PaymentRefund } from '../schema/payment-refund.entity';

export class PaymentRefundIdempotencyConflictError extends Error {
  constructor() {
    super('The payment refund idempotency key already exists.');
    this.name = PaymentRefundIdempotencyConflictError.name;
  }
}

export interface CreatePaymentRefundRecord {
  paymentId: string;
  idempotencyKey: string | null;
  requestId: string | null;
  previousPaymentStatus: PaymentStatus | null;
  gatewayTransactionId: string | null;
  responseCode: string | null;
  transactionStatus: string | null;
  message: string | null;
  reason: string | null;
  refundedByUserId: string | null;
  requestedAt: Date | null;
  refundedAt: Date | null;
  lastQueriedAt: Date | null;
}

export abstract class PaymentRefundStore {
  abstract findPaymentSnapshot(paymentId: string): Promise<Payment | null>;

  abstract findPayment(
    context: TransactionContext,
    paymentId: string,
  ): Promise<Payment | null>;

  abstract lockBooking(
    context: TransactionContext,
    bookingId: string,
  ): Promise<Booking | null>;

  abstract lockPayment(
    context: TransactionContext,
    paymentId: string,
  ): Promise<Payment | null>;

  abstract findByRefundIdempotencyKey(
    context: TransactionContext,
    key: string,
  ): Promise<PaymentRefund | null>;

  abstract createRefund(
    context: TransactionContext,
    input: CreatePaymentRefundRecord,
  ): Promise<PaymentRefund>;

  abstract lockCanonicalSuccessfulPayment(
    context: TransactionContext,
    canonicalPaymentId: string,
    bookingId: string,
  ): Promise<Payment | null>;

  abstract savePaymentState(
    context: TransactionContext,
    payment: Payment,
  ): Promise<void>;

  abstract saveRefundState(
    context: TransactionContext,
    refund: PaymentRefund,
  ): Promise<void>;

  abstract saveBookingState(
    context: TransactionContext,
    booking: Booking,
  ): Promise<void>;

  abstract recordRefundQueryFailure(
    paymentId: string,
    now: Date,
  ): Promise<void>;
}
