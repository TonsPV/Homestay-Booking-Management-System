import { HttpException, HttpStatus } from '@nestjs/common';

import type { ApiErrorDetails, ApiFieldErrors } from './api-response';
import type { ErrorCode } from '../error-codes';
import { getExpectedHttpStatus } from './error-codes';

export interface AppHttpExceptionOptions {
  details?: ApiErrorDetails;
  fieldErrors?: ApiFieldErrors;
}

export class AppHttpException extends HttpException {
  constructor(
    status: HttpStatus,
    errorCode: ErrorCode,
    message: string | string[],
    options: AppHttpExceptionOptions = {},
  ) {
    const expectedStatus = getExpectedHttpStatus(errorCode);

    if (status !== expectedStatus) {
      throw new Error(
        `Error code ${errorCode} must use HTTP status ${expectedStatus}, received ${status}.`,
      );
    }

    super(
      {
        error: HttpStatus[status] ?? 'Error',
        errorCode,
        message,
        ...(options.details === undefined ? {} : { details: options.details }),
        ...(options.fieldErrors === undefined
          ? {}
          : { fieldErrors: options.fieldErrors }),
      },
      status,
    );
  }
}
