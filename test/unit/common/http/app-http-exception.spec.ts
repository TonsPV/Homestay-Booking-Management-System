import { HttpStatus } from '@nestjs/common';

import { ErrorCode } from '../../../../src/common/error-codes';
import { AppHttpException } from '../../../../src/common/http/app-http-exception';

describe('AppHttpException', () => {
  it('stores the public error contract with optional fields', () => {
    const exception = new AppHttpException(
      HttpStatus.CONFLICT,
      ErrorCode.BOOKING_TRANSITION_NOT_ALLOWED,
      'Khong the chuyen booking.',
      {
        details: { retryable: false, limit: 3 },
        fieldErrors: {
          status: [
            {
              errorCode: ErrorCode.BOOKING_TRANSITION_NOT_ALLOWED,
              message: 'Trang thai booking khong hop le.',
            },
          ],
        },
      },
    );

    expect(exception.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(exception.getResponse()).toEqual({
      error: 'CONFLICT',
      errorCode: ErrorCode.BOOKING_TRANSITION_NOT_ALLOWED,
      message: 'Khong the chuyen booking.',
      details: { retryable: false, limit: 3 },
      fieldErrors: {
        status: [
          {
            errorCode: ErrorCode.BOOKING_TRANSITION_NOT_ALLOWED,
            message: 'Trang thai booking khong hop le.',
          },
        ],
      },
    });
  });

  it('omits optional fields when they are not supplied', () => {
    const exception = new AppHttpException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.CUSTOMER_CURRENT_PASSWORD_INVALID,
      'Mat khau hien tai khong dung.',
    );

    expect(exception.getResponse()).toEqual({
      error: 'BAD_REQUEST',
      errorCode: ErrorCode.CUSTOMER_CURRENT_PASSWORD_INVALID,
      message: 'Mat khau hien tai khong dung.',
    });
  });
});
