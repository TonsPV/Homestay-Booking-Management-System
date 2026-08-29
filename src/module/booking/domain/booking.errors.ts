import type { BookingStatus } from './booking-state';

export enum BookingTransitionDenialReason {
  REFUND_PENDING = 'REFUND_PENDING',
  TRANSITION_NOT_ALLOWED = 'TRANSITION_NOT_ALLOWED',
  CONFIRMATION_REQUIRES_PAYMENT = 'CONFIRMATION_REQUIRES_PAYMENT',
  CHECKIN_REQUIRES_PAYMENT = 'CHECKIN_REQUIRES_PAYMENT',
  CHECKIN_OUTSIDE_STAY_WINDOW = 'CHECKIN_OUTSIDE_STAY_WINDOW',
  ROOM_MISSING_FOR_BOOKING = 'ROOM_MISSING_FOR_BOOKING',
  ROOM_NOT_READY = 'ROOM_NOT_READY',
  CANCELLATION_ALREADY_PAID = 'CANCELLATION_ALREADY_PAID',
}

export class InvalidBookingStayDateError extends Error {
  constructor(
    readonly field: 'checkIn' | 'checkOut',
    message: string,
  ) {
    super(message);
    this.name = InvalidBookingStayDateError.name;
  }
}

export class InvalidBookingDateRangeError extends Error {
  constructor() {
    super('Ngay check-out phai sau ngay check-in.');
    this.name = InvalidBookingDateRangeError.name;
  }
}

export class BookingStayTooLongError extends Error {
  constructor(readonly maxStayNights: number) {
    super(`Booking khong duoc vuot qua ${maxStayNights} dem.`);
    this.name = BookingStayTooLongError.name;
  }
}

export class BookingCheckInInPastError extends Error {
  constructor() {
    super('Ngay check-in khong duoc nam trong qua khu.');
    this.name = BookingCheckInInPastError.name;
  }
}

export class BookingCheckInTooFarError extends Error {
  constructor(readonly maxAdvanceDays: number) {
    super(`Ngay check-in khong duoc qua ${maxAdvanceDays} ngay ke tu hom nay.`);
    this.name = BookingCheckInTooFarError.name;
  }
}

export class BookingTransitionNotAllowedError extends Error {
  constructor(
    readonly currentStatus: BookingStatus,
    readonly targetStatus: BookingStatus,
    readonly reason: BookingTransitionDenialReason,
    message: string,
  ) {
    super(message);
    this.name = BookingTransitionNotAllowedError.name;
  }
}
