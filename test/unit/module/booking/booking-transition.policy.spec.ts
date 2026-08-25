import { HttpStatus } from '@nestjs/common';

import { ErrorCode } from '../../../../src/common/error-codes';
import { AppHttpException } from '../../../../src/common/http/app-http-exception';
import { RoomStatus } from '../../../../src/module/room/schema/room.entity';
import {
  BookingTransitionPolicy,
  MANAGEMENT_STATUS_TRANSITIONS,
} from '../../../../src/module/booking/booking-transition.policy';
import {
  Booking,
  BookingPaymentStatus,
  BookingStatus,
} from '../../../../src/module/booking/schema/booking.entity';

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
    expect(
      policy.evaluate(unpaidOnline, BookingStatus.CONFIRMED).reasonCode,
    ).toBe(ErrorCode.BOOKING_CONFIRMATION_REQUIRES_PAYMENT);

    expect(
      policy.evaluate(
        bookingFixture({
          paymentStatus: BookingPaymentStatus.PAID,
          status: BookingStatus.PENDING_PAYMENT,
        }),
        BookingStatus.CANCELLED,
      ).reasonCode,
    ).toBe(ErrorCode.BOOKING_CANCELLATION_ALREADY_PAID);

    const unpaid = bookingFixture({
      paymentStatus: BookingPaymentStatus.UNPAID,
      status: BookingStatus.CONFIRMED,
    });
    expect(
      policy.evaluate(unpaid, BookingStatus.CHECKED_IN, {
        currentDate: '2030-02-01',
        roomExists: true,
        roomStatus: RoomStatus.READY,
      }).reasonCode,
    ).toBe(ErrorCode.BOOKING_CHECKIN_REQUIRES_PAYMENT);

    const paid = bookingFixture({
      paymentStatus: BookingPaymentStatus.PAID,
      status: BookingStatus.CONFIRMED,
    });
    expect(
      policy.evaluate(paid, BookingStatus.CHECKED_IN, {
        currentDate: '2030-02-04',
        roomExists: true,
        roomStatus: RoomStatus.READY,
      }).reasonCode,
    ).toBe(ErrorCode.BOOKING_CHECKIN_OUTSIDE_STAY_WINDOW);
    expect(
      policy.evaluate(paid, BookingStatus.CHECKED_IN, {
        currentDate: '2030-02-01',
        roomExists: false,
      }).reasonCode,
    ).toBe(ErrorCode.BOOKING_ROOM_MISSING_FOR_BOOKING);
    expect(
      policy.evaluate(paid, BookingStatus.CHECKED_IN, {
        currentDate: '2030-02-01',
        roomExists: true,
        roomStatus: RoomStatus.CLEANING,
      }).reasonCode,
    ).toBe(ErrorCode.BOOKING_ROOM_NOT_READY);
    expect(
      policy.evaluate(paid, BookingStatus.CHECKED_IN, {
        currentDate: '2030-02-01',
        refundPending: true,
        roomExists: true,
        roomStatus: RoomStatus.READY,
      }).reasonCode,
    ).toBe(ErrorCode.BOOKING_REFUND_PENDING);
  });

  it('asserts a denied capability with the same stable error code', () => {
    const booking = bookingFixture({ status: BookingStatus.CHECKED_IN });
    const capability = policy.evaluate(booking, BookingStatus.CONFIRMED);

    try {
      policy.assertAllowed(booking, capability);
      throw new Error('Expected the transition to be denied.');
    } catch (error) {
      expect(error).toBeInstanceOf(AppHttpException);
      expect((error as AppHttpException).getStatus()).toBe(HttpStatus.CONFLICT);
      expect((error as AppHttpException).getResponse()).toMatchObject({
        errorCode: ErrorCode.BOOKING_TRANSITION_NOT_ALLOWED,
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
      AppHttpException,
    );

    try {
      policy.assertAllowed(booking, capability);
    } catch (error) {
      expect(error).toMatchObject({
        response: {
          errorCode: ErrorCode.BOOKING_ROOM_MISSING_FOR_BOOKING,
        },
        status: HttpStatus.CONFLICT,
      });
    }
  });
});

function bookingFixture(overrides: Partial<Booking> = {}): Booking {
  return {
    id: '100',
    bookingCode: 'BK100',
    customerId: '10',
    customer: {} as Booking['customer'],
    roomId: '1',
    room: { status: RoomStatus.READY } as Booking['room'],
    createdByUserId: '20',
    createdByUser: null,
    checkInDate: '2030-02-01',
    checkOutDate: '2030-02-03',
    guestCount: 2,
    contactName: 'Customer',
    contactPhone: '+84901234567',
    contactEmail: null,
    totalAmount: '2000000.00',
    status: BookingStatus.PENDING_PAYMENT,
    paymentStatus: BookingPaymentStatus.PAID,
    paymentExpiresAt: null,
    customerNote: null,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: new Date('2030-01-01'),
    updatedAt: new Date('2030-01-01'),
    ...overrides,
  };
}
