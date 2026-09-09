import {
  BookingPaymentStatus,
  BookingStatus,
} from '../../../../src/module/booking/domain/booking-state';
import { assertBookingCanAcceptPayment } from '../../../../src/module/payment/domain/payment-booking.policy';
import { BookingPaymentNotAllowedError } from '../../../../src/module/payment/domain/payment.errors';

describe('payment booking domain policy', () => {
  const paymentTimeoutMs = 15 * 60 * 1000;
  const now = new Date('2030-01-01T00:10:00.000Z').getTime();

  it.each([BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED])(
    'allows an unpaid %s booking inside its payment window',
    (status) => {
      expect(() =>
        assertBookingCanAcceptPayment(
          bookingFixture({ status }),
          paymentTimeoutMs,
          now,
        ),
      ).not.toThrow();
    },
  );

  it.each([
    {
      booking: bookingFixture({
        paymentStatus: BookingPaymentStatus.PAID,
      }),
      reason: 'ALREADY_PAID',
      message: 'Booking da duoc thanh toan.',
    },
    {
      booking: bookingFixture({
        paymentStatus: BookingPaymentStatus.REFUNDED,
      }),
      reason: 'ALREADY_REFUNDED',
      message: 'Booking da duoc hoan tien.',
    },
    {
      booking: bookingFixture({ status: BookingStatus.CANCELLED }),
      reason: 'BOOKING_STATUS_NOT_PAYABLE',
      message: 'Khong the thanh toan booking o trang thai hien tai.',
    },
    {
      booking: bookingFixture({
        paymentExpiresAt: new Date('2030-01-01T00:09:59.000Z'),
      }),
      reason: 'PAYMENT_EXPIRED',
      message: 'Booking da het thoi gian thanh toan.',
    },
  ] as const)(
    'rejects payment with the semantic reason $reason',
    ({ booking, reason, message }) => {
      expect.assertions(3);

      try {
        assertBookingCanAcceptPayment(booking, paymentTimeoutMs, now);
      } catch (error) {
        expect(error).toBeInstanceOf(BookingPaymentNotAllowedError);
        expect(error).toMatchObject({ reason });
        expect(error).toHaveProperty('message', message);
      }
    },
  );

  it('uses the legacy created-at timeout when no deadline was persisted', () => {
    const booking = bookingFixture({ paymentExpiresAt: null });

    expect(() =>
      assertBookingCanAcceptPayment(
        booking,
        paymentTimeoutMs,
        new Date('2030-01-01T00:15:00.000Z').getTime(),
      ),
    ).toThrow(BookingPaymentNotAllowedError);
  });
});

function bookingFixture(
  overrides: Partial<{
    status: BookingStatus;
    paymentStatus: BookingPaymentStatus;
    paymentExpiresAt: Date | null;
    createdAt: Date;
  }> = {},
) {
  return {
    status: BookingStatus.PENDING_PAYMENT,
    paymentStatus: BookingPaymentStatus.UNPAID,
    paymentExpiresAt: new Date('2030-01-01T00:15:00.000Z'),
    createdAt: new Date('2030-01-01T00:00:00.000Z'),
    ...overrides,
  };
}
