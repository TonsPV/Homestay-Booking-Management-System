import { ConflictException } from '@nestjs/common';
import {
  assertBookingCanAcceptPayment as assertDomainBookingCanAcceptPayment,
  type BookingPaymentState,
} from './domain/payment-booking.policy';
import { BookingPaymentNotAllowedError } from './domain/payment.errors';

export function assertBookingCanAcceptPayment(
  booking: BookingPaymentState,
  paymentTimeoutMilliseconds: number,
): void {
  try {
    assertDomainBookingCanAcceptPayment(booking, paymentTimeoutMilliseconds);
  } catch (error) {
    if (error instanceof BookingPaymentNotAllowedError) {
      throw new ConflictException(error.message);
    }

    throw error;
  }
}
