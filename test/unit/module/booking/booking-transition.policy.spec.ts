import { RoomStatus } from '../../../../src/module/room/domain/room-status';
import {
  BookingTransitionPolicy,
  type BookingTransitionState,
  MANAGEMENT_STATUS_TRANSITIONS,
} from '../../../../src/module/booking/domain/booking-transition.policy';
import {
  BookingPaymentStatus,
  BookingStatus,
} from '../../../../src/module/booking/domain/booking-state';
import {
  BookingTransitionDenialReason,
  BookingTransitionNotAllowedError,
} from '../../../../src/module/booking/domain/booking.errors';

describe('BookingTransitionPolicy', () => {
  const policy = new BookingTransitionPolicy();

  it.each(Object.entries(MANAGEMENT_STATUS_TRANSITIONS))(
    'keeps the static transition table authoritative for %s',
    (currentStatus, allowedTargets) => {
      const booking = bookingFixture({
        status: currentStatus as BookingStatus,
        paymentStatus: BookingPaymentStatus.PAID,
      });
      const capabilities = policy.getCapabilities(booking, {
        currentDate: '2030-02-01',
        roomExists: true,
        roomStatus: RoomStatus.READY,
      });

      for (const capability of capabilities) {
        const expected =
          capability.targetStatus === booking.status ||
          (allowedTargets as BookingStatus[]).includes(capability.targetStatus);

        const expectedAllowed =
          capability.targetStatus === BookingStatus.CANCELLED &&
          booking.status !== BookingStatus.CANCELLED &&
          booking.paymentStatus === BookingPaymentStatus.PAID
            ? false
            : expected;

        expect(capability.allowed).toBe(expectedAllowed);
      }
    },
  );

  it('returns all dynamic reasons used by the management screen', () => {
    const unpaidOnline = bookingFixture({
      createdByUserId: null,
      paymentStatus: BookingPaymentStatus.UNPAID,
      status: BookingStatus.PENDING_PAYMENT,
    });
    expect(policy.evaluate(unpaidOnline, BookingStatus.CONFIRMED).reason).toBe(
      BookingTransitionDenialReason.CONFIRMATION_REQUIRES_PAYMENT,
    );

    expect(
      policy.evaluate(
        bookingFixture({
          paymentStatus: BookingPaymentStatus.PAID,
          status: BookingStatus.PENDING_PAYMENT,
        }),
        BookingStatus.CANCELLED,
      ).reason,
    ).toBe(BookingTransitionDenialReason.CANCELLATION_ALREADY_PAID);

    const unpaid = bookingFixture({
      paymentStatus: BookingPaymentStatus.UNPAID,
      status: BookingStatus.CONFIRMED,
    });
    expect(
      policy.evaluate(unpaid, BookingStatus.CHECKED_IN, {
        currentDate: '2030-02-01',
        roomExists: true,
        roomStatus: RoomStatus.READY,
      }).reason,
    ).toBe(BookingTransitionDenialReason.CHECKIN_REQUIRES_PAYMENT);

    const paid = bookingFixture({
      paymentStatus: BookingPaymentStatus.PAID,
      status: BookingStatus.CONFIRMED,
    });
    expect(
      policy.evaluate(paid, BookingStatus.CHECKED_IN, {
        currentDate: '2030-02-04',
        roomExists: true,
        roomStatus: RoomStatus.READY,
      }).reason,
    ).toBe(BookingTransitionDenialReason.CHECKIN_OUTSIDE_STAY_WINDOW);
    expect(
      policy.evaluate(paid, BookingStatus.CHECKED_IN, {
        currentDate: '2030-02-01',
        roomExists: false,
      }).reason,
    ).toBe(BookingTransitionDenialReason.ROOM_MISSING_FOR_BOOKING);
    expect(
      policy.evaluate(paid, BookingStatus.CHECKED_IN, {
        currentDate: '2030-02-01',
        roomExists: true,
        roomStatus: RoomStatus.CLEANING,
      }).reason,
    ).toBe(BookingTransitionDenialReason.ROOM_NOT_READY);
    expect(
      policy.evaluate(paid, BookingStatus.CHECKED_IN, {
        currentDate: '2030-02-01',
        refundPending: true,
        roomExists: true,
        roomStatus: RoomStatus.READY,
      }).reason,
    ).toBe(BookingTransitionDenialReason.REFUND_PENDING);
  });

  it('asserts a denied capability with the same stable error code', () => {
    const booking = bookingFixture({ status: BookingStatus.CHECKED_IN });
    const capability = policy.evaluate(booking, BookingStatus.CONFIRMED);

    try {
      policy.assertAllowed(booking, capability);
      throw new Error('Expected the transition to be denied.');
    } catch (error) {
      expect(error).toBeInstanceOf(BookingTransitionNotAllowedError);
      expect(error).toMatchObject({
        reason: BookingTransitionDenialReason.TRANSITION_NOT_ALLOWED,
        currentStatus: BookingStatus.CHECKED_IN,
        targetStatus: BookingStatus.CONFIRMED,
      });
    }
  });

  it('uses the contextual missing-room code for lifecycle conflicts', () => {
    const booking = bookingFixture({
      paymentStatus: BookingPaymentStatus.PAID,
      status: BookingStatus.CONFIRMED,
    });
    const capability = policy.evaluate(booking, BookingStatus.CHECKED_IN, {
      currentDate: '2030-02-01',
      roomExists: false,
    });

    expect(() => policy.assertAllowed(booking, capability)).toThrow(
      BookingTransitionNotAllowedError,
    );

    try {
      policy.assertAllowed(booking, capability);
    } catch (error) {
      expect(error).toMatchObject({
        reason: BookingTransitionDenialReason.ROOM_MISSING_FOR_BOOKING,
      });
    }
  });
});

function bookingFixture(
  overrides: Partial<BookingTransitionState> = {},
): BookingTransitionState {
  return {
    createdByUserId: '20',
    checkInDate: '2030-02-01',
    checkOutDate: '2030-02-03',
    status: BookingStatus.PENDING_PAYMENT,
    paymentStatus: BookingPaymentStatus.PAID,
    ...overrides,
  };
}
