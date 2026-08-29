import { ConflictException } from '@nestjs/common';

import {
  BookingPaymentStatus,
  BookingStatus,
} from '../../../../src/module/booking/domain/booking-state';
import { assertBookingCanAcceptPayment } from '../../../../src/module/payment/payment-booking.application';

describe('payment booking application boundary', () => {
  it('maps a domain payment rejection to the existing ConflictException', () => {
    expect(() =>
      assertBookingCanAcceptPayment(
        {
          status: BookingStatus.CONFIRMED,
          paymentStatus: BookingPaymentStatus.PAID,
          paymentExpiresAt: null,
          createdAt: new Date('2030-01-01T00:00:00.000Z'),
        },
        15 * 60 * 1000,
      ),
    ).toThrow(ConflictException);
  });
});
