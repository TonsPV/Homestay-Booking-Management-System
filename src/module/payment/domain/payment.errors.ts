export type BookingPaymentNotAllowedReason =
  | 'ALREADY_PAID'
  | 'ALREADY_REFUNDED'
  | 'BOOKING_STATUS_NOT_PAYABLE'
  | 'PAYMENT_EXPIRED';

export class BookingPaymentNotAllowedError extends Error {
  constructor(
    readonly reason: BookingPaymentNotAllowedReason,
    message: string,
  ) {
    super(message);
    this.name = BookingPaymentNotAllowedError.name;
  }
}
