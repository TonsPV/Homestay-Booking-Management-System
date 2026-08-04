import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

import { AppHttpException } from './app-http-exception';
import type {
  ApiErrorDetails,
  ApiErrorResponse,
  ApiFieldError,
  ApiFieldErrors,
} from './api-response';
import type { AppRequest } from './auth.types';
import {
  getFallbackErrorCode,
  isErrorCode,
  type ErrorCode,
} from './error-codes';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<AppRequest>();
    const response = http.getResponse<Response>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (!(exception instanceof HttpException)) {
      this.logUnexpectedException(exception, request);
    }

    const fieldErrors = this.getFieldErrors(exception);
    const details = this.getDetails(exception);
    const body: ApiErrorResponse = {
      success: false,
      statusCode,
      errorCode: this.getErrorCode(exception, statusCode),
      message: this.getMessage(exception),
      ...(fieldErrors === undefined ? {} : { fieldErrors }),
      ...(details === undefined ? {} : { details }),
      error: this.getError(exception, statusCode),
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
      requestId: request.requestId ?? 'unknown',
    };

    response.status(statusCode).json(body);
  }

  private logUnexpectedException(
    exception: unknown,
    request: AppRequest,
  ): void {
    const context = `[requestId=${request.requestId ?? 'unknown'}] ${request.method} ${request.originalUrl}`;

    if (exception instanceof Error) {
      this.logger.error(
        `${context} - ${exception.name}: ${exception.message}`,
        exception.stack,
      );
      return;
    }

    this.logger.error(`${context} - Non-Error exception received.`);
  }

  private getMessage(exception: unknown): string | string[] {
    if (!(exception instanceof HttpException)) {
      return 'Internal server error.';
    }

    const response = exception.getResponse();

    if (typeof response === 'string') {
      return response;
    }

    if (
      response !== null &&
      typeof response === 'object' &&
      'message' in response
    ) {
      const message = response.message;

      if (typeof message === 'string' || Array.isArray(message)) {
        return message as string | string[];
      }
    }

    return exception.message;
  }

  private getError(exception: unknown, statusCode: number): string {
    if (!(exception instanceof HttpException)) {
      return 'Internal Server Error';
    }

    const response = exception.getResponse();

    if (
      response !== null &&
      typeof response === 'object' &&
      'error' in response &&
      typeof response.error === 'string'
    ) {
      return response.error;
    }

    return HttpStatus[statusCode] ?? exception.name;
  }

  private getErrorCode(exception: unknown, statusCode: number): ErrorCode {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();

      if (
        response !== null &&
        typeof response === 'object' &&
        'errorCode' in response &&
        isErrorCode(response.errorCode)
      ) {
        return response.errorCode;
      }
    }

    return getFallbackErrorCode(statusCode);
  }

  private getFieldErrors(exception: unknown): ApiFieldErrors | undefined {
    if (!(exception instanceof AppHttpException)) {
      return undefined;
    }

    const response = exception.getResponse();

    if (
      response === null ||
      typeof response !== 'object' ||
      !('fieldErrors' in response) ||
      response.fieldErrors === null ||
      typeof response.fieldErrors !== 'object' ||
      Array.isArray(response.fieldErrors)
    ) {
      return undefined;
    }

    const rawFieldErrors = response.fieldErrors as Record<string, unknown>;
    const fieldErrors: ApiFieldErrors = {};

    for (const [field, errors] of Object.entries(rawFieldErrors)) {
      if (!Array.isArray(errors)) {
        continue;
      }

      const safeErrors = errors
        .map((error: unknown): ApiFieldError | undefined => {
          if (
            error === null ||
            typeof error !== 'object' ||
            !('errorCode' in error) ||
            !isErrorCode(error.errorCode)
          ) {
            return undefined;
          }

          const message =
            'message' in error && typeof error.message === 'string'
              ? error.message
              : undefined;

          return {
            errorCode: error.errorCode,
            ...(message === undefined ? {} : { message }),
          };
        })
        .filter((error): error is ApiFieldError => error !== undefined);

      if (safeErrors.length > 0) {
        fieldErrors[field] = safeErrors;
      }
    }

    return Object.keys(fieldErrors).length === 0 ? undefined : fieldErrors;
  }

  private getDetails(exception: unknown): ApiErrorDetails | undefined {
    if (!(exception instanceof AppHttpException)) {
      return undefined;
    }

    const response = exception.getResponse();

    if (
      response === null ||
      typeof response !== 'object' ||
      !('details' in response) ||
      response.details === null ||
      typeof response.details !== 'object' ||
      Array.isArray(response.details)
    ) {
      return undefined;
    }

    const rawDetails = response.details as Record<string, unknown>;
    const details: ApiErrorDetails = {};

    if (typeof rawDetails.retryable === 'boolean') {
      details.retryable = rawDetails.retryable;
    }

    for (const key of ['limit', 'maxAdvanceDays', 'maxStayNights'] as const) {
      const value = rawDetails[key];

      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        details[key] = value;
      }
    }

    return Object.keys(details).length === 0 ? undefined : details;
  }
}
