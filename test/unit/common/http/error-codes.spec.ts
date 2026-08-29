import { HttpStatus } from '@nestjs/common';

import { ErrorCode } from '../../../../src/common/error-codes';
import {
  ERROR_CODE_HTTP_STATUS,
  getFallbackErrorCode,
  isErrorCodeStatusCompatible,
} from '../../../../src/common/http/error-codes';
import { AppHttpException } from '../../../../src/common/http/app-http-exception';

describe('ErrorCode HTTP status contract', () => {
  it('declares one canonical status for every application error code', () => {
    expect(Object.keys(ERROR_CODE_HTTP_STATUS).sort()).toEqual(
      Object.values(ErrorCode).sort(),
    );

    for (const errorCode of Object.values(ErrorCode)) {
      expect(ERROR_CODE_HTTP_STATUS[errorCode]).toEqual(expect.any(Number));
    }
  });

  it('keeps room lookup and booking-lifecycle room failures contextual', () => {
    expect(ERROR_CODE_HTTP_STATUS[ErrorCode.BOOKING_ROOM_NOT_FOUND]).toBe(
      HttpStatus.NOT_FOUND,
    );
    expect(
      ERROR_CODE_HTTP_STATUS[ErrorCode.BOOKING_ROOM_MISSING_FOR_BOOKING],
    ).toBe(HttpStatus.CONFLICT);

    expect(
      () =>
        new AppHttpException(
          HttpStatus.CONFLICT,
          ErrorCode.BOOKING_ROOM_NOT_FOUND,
          'invalid status contract',
        ),
    ).toThrow('BOOKING_ROOM_NOT_FOUND must use HTTP status 404');
  });

  it('rejects an application exception whose status drifts from its code', () => {
    expect(
      () =>
        new AppHttpException(
          HttpStatus.NOT_FOUND,
          ErrorCode.BOOKING_ROOM_MISSING_FOR_BOOKING,
          'invalid status contract',
        ),
    ).toThrow('BOOKING_ROOM_MISSING_FOR_BOOKING must use HTTP status 409');
  });

  it('preserves intentional common fallback status families', () => {
    expect(getFallbackErrorCode(400)).toBe(ErrorCode.COMMON_VALIDATION_FAILED);
    expect(getFallbackErrorCode(422)).toBe(ErrorCode.COMMON_VALIDATION_FAILED);
    expect(getFallbackErrorCode(502)).toBe(
      ErrorCode.COMMON_SERVICE_UNAVAILABLE,
    );
    expect(getFallbackErrorCode(503)).toBe(
      ErrorCode.COMMON_SERVICE_UNAVAILABLE,
    );
    expect(getFallbackErrorCode(504)).toBe(
      ErrorCode.COMMON_SERVICE_UNAVAILABLE,
    );
    expect(
      isErrorCodeStatusCompatible(ErrorCode.COMMON_VALIDATION_FAILED, 422),
    ).toBe(true);
    expect(
      isErrorCodeStatusCompatible(ErrorCode.COMMON_SERVICE_UNAVAILABLE, 504),
    ).toBe(true);
    expect(
      isErrorCodeStatusCompatible(ErrorCode.BOOKING_ROOM_NOT_FOUND, 409),
    ).toBe(false);
  });
});
