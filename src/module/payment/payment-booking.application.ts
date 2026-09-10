import { ConflictException } from '@nestjs/common';
import {
  assertBookingCanAcceptPayment as assertPaymentAllowed,
  type BookingPaymentState,
} from './domain/payment-booking.policy';
import { BookingPaymentNotAllowedError } from './domain/payment.errors';

export function assertBookingCanAcceptPayment(
  booking: BookingPaymentState,
  paymentTimeoutMs: number,
): void {
  try {
    assertPaymentAllowed(booking, paymentTimeoutMs);
  } catch (error) {
    if (error instanceof BookingPaymentNotAllowedError) {
      throw new ConflictException(error.message);
    }

    throw error;
  }
}
