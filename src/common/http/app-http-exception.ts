import { HttpException, HttpStatus } from '@nestjs/common';

import type { ApiErrorDetails, ApiFieldErrors } from './api-response';
import type { ErrorCode } from './error-codes';

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
