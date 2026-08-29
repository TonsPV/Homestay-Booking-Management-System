import type { TransactionContext } from '../../../common/application/transaction';
import type { Booking } from '../../booking/schema/booking.entity';
import type { Payment } from '../schema/payment.entity';
import { PaymentMethod, PaymentStatus } from '../domain/payment-state';

export class PaymentIdempotencyConflictError extends Error {
  constructor() {
    super('The payment idempotency key already exists.');
    this.name = PaymentIdempotencyConflictError.name;
  }
}

export interface CreatePaymentRecord {
  bookingId: string;
  amount: string;
  currency: 'VND';
  method: PaymentMethod;
  status: PaymentStatus;
  gatewayName: string | null;
  gatewayReference: string | null;
  gatewayTransactionId: string | null;
  gatewayPaymentUrl: string | null;
  gatewayResponseCode: string | null;
  gatewayTransactionStatus: string | null;
  idempotencyKey: string;
  createdByUserId: string | null;
  paidAt: Date | null;
  expiresAt: Date | null;
}

export abstract class PaymentAcceptanceStore {
  abstract findPaymentSnapshot(paymentId: string): Promise<Payment | null>;

  abstract lockBooking(
    context: TransactionContext,
    bookingId: string,
  ): Promise<Booking | null>;

  abstract findByIdempotencyKey(
    context: TransactionContext,
    key: string,
  ): Promise<Payment | null>;

  abstract findByIdempotencyKeySnapshot(key: string): Promise<Payment | null>;

  abstract findByGatewayReferenceSnapshot(
    gatewayReference: string,
  ): Promise<Payment | null>;

  abstract expirePendingOnlineAttempts(
    context: TransactionContext,
    bookingId: string,
    now: Date,
  ): Promise<void>;

  abstract hasPendingOnlineAttempt(
    context: TransactionContext,
    bookingId: string,
  ): Promise<boolean>;

  abstract createPayment(
    context: TransactionContext,
    input: CreatePaymentRecord,
  ): Promise<Payment>;

  abstract savePaymentState(
    context: TransactionContext,
    payment: Payment | Payment[],
  ): Promise<void>;

  abstract saveBookingState(
    context: TransactionContext,
    booking: Booking,
  ): Promise<void>;

  abstract lockPayment(
    context: TransactionContext,
    paymentId: string,
  ): Promise<Payment | null>;

  abstract lockCanonicalPayment(
    context: TransactionContext,
    bookingId: string,
    excludedPaymentId: string,
  ): Promise<Payment | null>;

  abstract lockExpiredOnlinePayments(
    context: TransactionContext,
    now: Date,
    limit: number,
  ): Promise<Payment[]>;
}
