import { HttpStatus } from '@nestjs/common';

import { ErrorCode, type ErrorCode as ErrorCodeType } from '../error-codes';

/**
 * HTTP status contract for application exceptions.
 *
 * The filter's generic transport fallback intentionally maps status families
 * such as 400/422 and 502/503/504 to one COMMON_* code. This table governs
 * explicit AppHttpException instances, where a business code must have one
 * canonical status.
 */
export const ERROR_CODE_HTTP_STATUS = {
  [ErrorCode.COMMON_VALIDATION_FAILED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.COMMON_UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.COMMON_FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCode.COMMON_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.COMMON_CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.COMMON_RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
  [ErrorCode.COMMON_PAYLOAD_TOO_LARGE]: HttpStatus.PAYLOAD_TOO_LARGE,
  [ErrorCode.COMMON_UNSUPPORTED_MEDIA_TYPE]: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  [ErrorCode.COMMON_SERVICE_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
  [ErrorCode.COMMON_INTERNAL_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ErrorCode.CUSTOMER_INITIAL_PASSWORD_ALREADY_CONFIGURED]: HttpStatus.CONFLICT,
  [ErrorCode.CUSTOMER_EMAIL_IN_USE]: HttpStatus.CONFLICT,
  [ErrorCode.CUSTOMER_PHONE_IN_USE]: HttpStatus.CONFLICT,
  [ErrorCode.CUSTOMER_CURRENT_PASSWORD_INVALID]: HttpStatus.BAD_REQUEST,
  [ErrorCode.CUSTOMER_PASSWORD_REUSE_NOT_ALLOWED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.AUTH_GOOGLE_PHONE_REQUIRED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.AUTH_GOOGLE_ACCOUNT_CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.AUTH_GOOGLE_INVALID_TOKEN]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.AMENITY_NAME_ALREADY_EXISTS]: HttpStatus.CONFLICT,
  [ErrorCode.AMENITY_IN_USE]: HttpStatus.CONFLICT,
  [ErrorCode.ROOM_TYPE_IN_USE]: HttpStatus.CONFLICT,
  [ErrorCode.BOOKING_GUEST_CAPACITY_EXCEEDED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.BOOKING_CUSTOMER_CONTACT_REQUIRED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.BOOKING_ACTIVE_UNPAID_LIMIT_REACHED]: HttpStatus.CONFLICT,
  [ErrorCode.BOOKING_HELD_NIGHTS_LIMIT_REACHED]: HttpStatus.CONFLICT,
  [ErrorCode.BOOKING_ROOM_NOT_BOOKABLE]: HttpStatus.CONFLICT,
  [ErrorCode.BOOKING_CHECKIN_IN_PAST]: HttpStatus.BAD_REQUEST,
  [ErrorCode.BOOKING_CHECKIN_TOO_FAR]: HttpStatus.BAD_REQUEST,
  [ErrorCode.BOOKING_DATE_RANGE_INVALID]: HttpStatus.BAD_REQUEST,
  [ErrorCode.BOOKING_STAY_TOO_LONG]: HttpStatus.BAD_REQUEST,
  [ErrorCode.BOOKING_TOTAL_LIMIT_EXCEEDED]: HttpStatus.CONFLICT,
  [ErrorCode.BOOKING_ROOM_UNAVAILABLE]: HttpStatus.CONFLICT,
  [ErrorCode.BOOKING_CREATE_CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.BOOKING_REQUEST_INTENT_CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.BOOKING_CANCELLATION_REASON_REQUIRED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.BOOKING_REFUND_PENDING]: HttpStatus.CONFLICT,
  [ErrorCode.BOOKING_TRANSITION_NOT_ALLOWED]: HttpStatus.CONFLICT,
  [ErrorCode.BOOKING_CONFIRMATION_REQUIRES_PAYMENT]: HttpStatus.CONFLICT,
  [ErrorCode.BOOKING_CHECKIN_REQUIRES_PAYMENT]: HttpStatus.CONFLICT,
  [ErrorCode.BOOKING_CHECKIN_OUTSIDE_STAY_WINDOW]: HttpStatus.CONFLICT,
  [ErrorCode.BOOKING_ROOM_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.BOOKING_ROOM_MISSING_FOR_BOOKING]: HttpStatus.CONFLICT,
  [ErrorCode.BOOKING_ROOM_NOT_READY]: HttpStatus.CONFLICT,
  [ErrorCode.BOOKING_CANCELLATION_ALREADY_PAID]: HttpStatus.CONFLICT,
  [ErrorCode.BOOKING_CANCELLATION_NOT_ALLOWED]: HttpStatus.CONFLICT,
  [ErrorCode.PAYMENT_REFUND_REJECTED]: HttpStatus.CONFLICT,
  [ErrorCode.PAYMENT_REFUND_NOT_ALLOWED]: HttpStatus.CONFLICT,
  [ErrorCode.PAYMENT_REFUND_OUTCOME_UNKNOWN]: HttpStatus.SERVICE_UNAVAILABLE,
  [ErrorCode.PAYMENT_IDEMPOTENCY_KEY_CONFLICT]: HttpStatus.CONFLICT,
} as const satisfies Record<ErrorCodeType, HttpStatus>;

const FALLBACK_HTTP_STATUSES: Partial<
  Record<ErrorCodeType, readonly number[]>
> = {
  [ErrorCode.COMMON_VALIDATION_FAILED]: [400, 422],
  [ErrorCode.COMMON_SERVICE_UNAVAILABLE]: [502, 503, 504],
};

export function getExpectedHttpStatus(errorCode: ErrorCodeType): HttpStatus {
  return ERROR_CODE_HTTP_STATUS[errorCode];
}

export function isErrorStatusCompatible(
  errorCode: ErrorCodeType,
  statusCode: number,
): boolean {
  return (
    FALLBACK_HTTP_STATUSES[errorCode]?.includes(statusCode) ??
    Number(ERROR_CODE_HTTP_STATUS[errorCode]) === statusCode
  );
}

export function getFallbackErrorCode(statusCode: number): ErrorCodeType {
  switch (statusCode) {
    case 400:
    case 422:
      return ErrorCode.COMMON_VALIDATION_FAILED;
    case 401:
      return ErrorCode.COMMON_UNAUTHORIZED;
    case 403:
      return ErrorCode.COMMON_FORBIDDEN;
    case 404:
      return ErrorCode.COMMON_NOT_FOUND;
    case 409:
      return ErrorCode.COMMON_CONFLICT;
    case 429:
      return ErrorCode.COMMON_RATE_LIMITED;
    case 413:
      return ErrorCode.COMMON_PAYLOAD_TOO_LARGE;
    case 415:
      return ErrorCode.COMMON_UNSUPPORTED_MEDIA_TYPE;
    case 502:
    case 503:
    case 504:
      return ErrorCode.COMMON_SERVICE_UNAVAILABLE;
    default:
      return ErrorCode.COMMON_INTERNAL_ERROR;
  }
}
