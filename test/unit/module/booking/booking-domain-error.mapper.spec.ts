import { BadRequestException, HttpStatus } from '@nestjs/common';

import { ErrorCode } from '../../../../src/common/error-codes';
import { AppHttpException } from '../../../../src/common/http/app-http-exception';
import {
  throwMappedBookingDomainError,
  toTransitionCapability,
} from '../../../../src/module/booking/booking-domain-error.mapper';
import {
  BookingCheckInTooFarError,
  BookingTransitionDenialReason,
  BookingTransitionNotAllowedError,
  InvalidBookingDateRangeError,
  InvalidBookingStayDateError,
} from '../../../../src/module/booking/domain/booking.errors';
import { BookingStatus } from '../../../../src/module/booking/domain/booking-state';

describe('booking domain error HTTP mapping', () => {
  it('preserves the plain 400 response for an invalid ISO date', () => {
    try {
      throwMappedBookingDomainError(
        new InvalidBookingStayDateError(
          'checkIn',
          'Ngay check-in khong hop le.',
        ),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({ status: HttpStatus.BAD_REQUEST });
      expect(error).toHaveProperty(
        'response.message',
        'Ngay check-in khong hop le.',
      );
    }
  });

  it('preserves the stable error code and caller-specific query field', () => {
    try {
      throwMappedBookingDomainError(new InvalidBookingDateRangeError(), {
        checkIn: 'checkIn',
        checkOut: 'checkOut',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AppHttpException);
      expect(error).toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: {
          errorCode: ErrorCode.BOOKING_DATE_RANGE_INVALID,
          fieldErrors: {
            checkOut: [
              {
                errorCode: ErrorCode.BOOKING_DATE_RANGE_INVALID,
                message: 'Ngay check-out phai sau ngay check-in.',
              },
            ],
          },
        },
      });
    }
  });

  it('preserves advance-window details and field copy', () => {
    try {
      throwMappedBookingDomainError(new BookingCheckInTooFarError(365));
    } catch (error) {
      expect(error).toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: {
          errorCode: ErrorCode.BOOKING_CHECKIN_TOO_FAR,
          details: { maxAdvanceDays: 365 },
          fieldErrors: {
            checkInDate: [
              {
                errorCode: ErrorCode.BOOKING_CHECKIN_TOO_FAR,
                message: 'Ngay check-in vuot qua thoi gian dat truoc.',
              },
            ],
          },
        },
      });
    }
  });

  it('maps transition rejection back to the original 409 contract', () => {
    try {
      throwMappedBookingDomainError(
        new BookingTransitionNotAllowedError(
          BookingStatus.CHECKED_IN,
          BookingStatus.CONFIRMED,
          BookingTransitionDenialReason.TRANSITION_NOT_ALLOWED,
          'Khong the chuyen booking tu CHECKED_IN sang CONFIRMED.',
        ),
      );
    } catch (error) {
      expect(error).toMatchObject({
        status: HttpStatus.CONFLICT,
        response: {
          errorCode: ErrorCode.BOOKING_TRANSITION_NOT_ALLOWED,
          message: 'Khong the chuyen booking tu CHECKED_IN sang CONFIRMED.',
        },
      });
    }
  });

  it('keeps public transition capability reason codes unchanged', () => {
    expect(
      toTransitionCapability({
        targetStatus: BookingStatus.CONFIRMED,
        allowed: false,
        reason: BookingTransitionDenialReason.CONFIRMATION_REQUIRES_PAYMENT,
      }),
    ).toEqual({
      targetStatus: BookingStatus.CONFIRMED,
      allowed: false,
      reasonCode: ErrorCode.BOOKING_CONFIRMATION_REQUIRES_PAYMENT,
    });
  });
});
