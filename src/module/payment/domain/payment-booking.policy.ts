import {
  BookingPaymentStatus,
  BookingStatus,
} from '../../booking/domain/booking-state';
import { BookingPaymentNotAllowedError } from './payment.errors';

export interface BookingPaymentState {
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  paymentExpiresAt: Date | null;
  createdAt: Date;
}

export function assertBookingCanAcceptPayment(
  booking: BookingPaymentState,
  paymentTimeoutMs: number,
  now = Date.now(),
): void {
  if (booking.paymentStatus === BookingPaymentStatus.PAID) {
    throw new BookingPaymentNotAllowedError(
      'ALREADY_PAID',
      'Booking da duoc thanh toan.',
    );
  }

  if (booking.paymentStatus === BookingPaymentStatus.REFUNDED) {
    throw new BookingPaymentNotAllowedError(
      'ALREADY_REFUNDED',
      'Booking da duoc hoan tien.',
    );
  }

  if (
    booking.status !== BookingStatus.PENDING_PAYMENT &&
    booking.status !== BookingStatus.CONFIRMED
  ) {
    throw new BookingPaymentNotAllowedError(
      'BOOKING_STATUS_NOT_PAYABLE',
      'Khong the thanh toan booking o trang thai hien tai.',
    );
  }

  const paymentExpiresAt =
    booking.paymentExpiresAt ??
    new Date(booking.createdAt.getTime() + paymentTimeoutMs);

  if (
    booking.status === BookingStatus.PENDING_PAYMENT &&
    paymentExpiresAt.getTime() <= now
  ) {
    throw new BookingPaymentNotAllowedError(
      'PAYMENT_EXPIRED',
      'Booking da het thoi gian thanh toan.',
    );
  }
}
