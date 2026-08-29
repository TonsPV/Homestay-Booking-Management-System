import { BadRequestException, HttpStatus } from '@nestjs/common';

import { ErrorCode } from '../../common/error-codes';
import { AppHttpException } from '../../common/http/app-http-exception';
import {
  BookingTransitionDenialReason,
  BookingCheckInInPastError,
  BookingCheckInTooFarError,
  BookingStayTooLongError,
  BookingTransitionNotAllowedError,
  InvalidBookingDateRangeError,
  InvalidBookingStayDateError,
} from './domain/booking.errors';
import type { BookingTransitionCapability } from './domain/booking-transition.policy';
import type { BookingStatus } from './domain/booking-state';

const BOOKING_TRANSITION_ERROR_CODE_BY_REASON = {
  [BookingTransitionDenialReason.REFUND_PENDING]:
    ErrorCode.BOOKING_REFUND_PENDING,
  [BookingTransitionDenialReason.TRANSITION_NOT_ALLOWED]:
    ErrorCode.BOOKING_TRANSITION_NOT_ALLOWED,
  [BookingTransitionDenialReason.CONFIRMATION_REQUIRES_PAYMENT]:
    ErrorCode.BOOKING_CONFIRMATION_REQUIRES_PAYMENT,
  [BookingTransitionDenialReason.CHECKIN_REQUIRES_PAYMENT]:
    ErrorCode.BOOKING_CHECKIN_REQUIRES_PAYMENT,
  [BookingTransitionDenialReason.CHECKIN_OUTSIDE_STAY_WINDOW]:
    ErrorCode.BOOKING_CHECKIN_OUTSIDE_STAY_WINDOW,
  [BookingTransitionDenialReason.ROOM_MISSING_FOR_BOOKING]:
    ErrorCode.BOOKING_ROOM_MISSING_FOR_BOOKING,
  [BookingTransitionDenialReason.ROOM_NOT_READY]:
    ErrorCode.BOOKING_ROOM_NOT_READY,
  [BookingTransitionDenialReason.CANCELLATION_ALREADY_PAID]:
    ErrorCode.BOOKING_CANCELLATION_ALREADY_PAID,
} as const satisfies Record<BookingTransitionDenialReason, ErrorCode>;

export const BOOKING_TRANSITION_REASON_CODES = Object.values(
  BOOKING_TRANSITION_ERROR_CODE_BY_REASON,
);

export type BookingTransitionReasonCode =
  (typeof BOOKING_TRANSITION_ERROR_CODE_BY_REASON)[BookingTransitionDenialReason];

export interface BookingTransitionCapabilityResponse {
  targetStatus: BookingStatus;
  allowed: boolean;
  reasonCode: BookingTransitionReasonCode | null;
}

export interface BookingStayFieldNames {
  checkIn: string;
  checkOut: string;
}

const DEFAULT_STAY_FIELD_NAMES: BookingStayFieldNames = {
  checkIn: 'checkInDate',
  checkOut: 'checkOutDate',
};

export function throwMappedBookingDomainError(
  error: unknown,
  fieldNames: BookingStayFieldNames = DEFAULT_STAY_FIELD_NAMES,
): never {
  if (error instanceof InvalidBookingStayDateError) {
    throw new BadRequestException(error.message);
  }

  if (error instanceof InvalidBookingDateRangeError) {
    throw bookingStayValidationException(
      ErrorCode.BOOKING_DATE_RANGE_INVALID,
      error.message,
      fieldNames.checkOut,
    );
  }

  if (error instanceof BookingStayTooLongError) {
    throw bookingStayValidationException(
      ErrorCode.BOOKING_STAY_TOO_LONG,
      error.message,
      fieldNames.checkOut,
      { maxStayNights: error.maxStayNights },
    );
  }

  if (error instanceof BookingCheckInInPastError) {
    throw bookingStayValidationException(
      ErrorCode.BOOKING_CHECKIN_IN_PAST,
      error.message,
      fieldNames.checkIn,
    );
  }

  if (error instanceof BookingCheckInTooFarError) {
    throw bookingStayValidationException(
      ErrorCode.BOOKING_CHECKIN_TOO_FAR,
      error.message,
      fieldNames.checkIn,
      { maxAdvanceDays: error.maxAdvanceDays },
      'Ngay check-in vuot qua thoi gian dat truoc.',
    );
  }

  if (error instanceof BookingTransitionNotAllowedError) {
    throw new AppHttpException(
      HttpStatus.CONFLICT,
      mapBookingTransitionReason(error.reason),
      error.message,
    );
  }

  throw error;
}

export function toBookingTransitionCapabilityResponse(
  capability: BookingTransitionCapability,
): BookingTransitionCapabilityResponse {
  return {
    targetStatus: capability.targetStatus,
    allowed: capability.allowed,
    reasonCode:
      capability.reason === null
        ? null
        : mapBookingTransitionReason(capability.reason),
  };
}

function mapBookingTransitionReason(
  reason: BookingTransitionDenialReason,
): BookingTransitionReasonCode {
  return BOOKING_TRANSITION_ERROR_CODE_BY_REASON[reason];
}

function bookingStayValidationException(
  errorCode: ErrorCode,
  message: string,
  field: string,
  details?: { maxAdvanceDays?: number; maxStayNights?: number },
  fieldMessage = message,
): AppHttpException {
  return new AppHttpException(HttpStatus.BAD_REQUEST, errorCode, message, {
    ...(details === undefined ? {} : { details }),
    fieldErrors: {
      [field]: [{ errorCode, message: fieldMessage }],
    },
  });
}
