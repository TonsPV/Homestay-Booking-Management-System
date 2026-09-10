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
import type { AppRequest } from './request.types';
import { createRequestMetadata } from './request-metadata';
import { getFallbackErrorCode, isErrorStatusCompatible } from './error-codes';
import { isErrorCode, type ErrorCode } from '../error-codes';

const INVALID_MESSAGE_FALLBACK = 'Request validation failed.';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<AppRequest>();
    const response = http.getResponse<Response>();
    const statusCode = this.getStatusCode(exception);

    if (!(exception instanceof HttpException) && statusCode >= 500) {
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
      ...createRequestMetadata(request),
    };

    response.status(statusCode).json(body);
  }

  private logUnexpectedException(
    exception: unknown,
    request: AppRequest,
  ): void {
    this.logger.error({
      event: 'unexpected_http_exception',
      requestId: request.requestId ?? 'unknown',
      method: request.method,
      statusCode: this.getStatusCode(exception),
      exceptionType: exception instanceof Error ? 'Error' : 'NonError',
    });
  }

  private getMessage(exception: unknown): string | string[] {
    if (!(exception instanceof HttpException)) {
      if (this.getStatusCode(exception) === 413) {
        return 'Request body too large.';
      }

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

      if (typeof message === 'string') {
        return message;
      }

      if (Array.isArray(message)) {
        const safeMessages = message.filter(
          (item: unknown): item is string => typeof item === 'string',
        );

        return safeMessages.length === message.length
          ? safeMessages
          : INVALID_MESSAGE_FALLBACK;
      }
    }

    return exception.message;
  }

  private getError(exception: unknown, statusCode: number): string {
    if (!(exception instanceof HttpException)) {
      return statusCode === 500
        ? 'Internal Server Error'
        : (HttpStatus[statusCode] ?? 'Internal Server Error');
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
        isErrorCode(response.errorCode) &&
        isErrorStatusCompatible(response.errorCode, statusCode)
      ) {
        return response.errorCode;
      }
    }

    return getFallbackErrorCode(statusCode);
  }

  private getStatusCode(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    if (exception === null || typeof exception !== 'object') {
      return HttpStatus.INTERNAL_SERVER_ERROR;
    }

    if (
      'statusCode' in exception &&
      typeof exception.statusCode === 'number' &&
      Number.isInteger(exception.statusCode) &&
      exception.statusCode >= 400 &&
      exception.statusCode <= 599
    ) {
      return exception.statusCode;
    }

    if ('code' in exception && typeof exception.code === 'string') {
      if (exception.code === 'LIMIT_FILE_SIZE') {
        return HttpStatus.PAYLOAD_TOO_LARGE;
      }

      if (exception.code.startsWith('LIMIT_')) {
        return HttpStatus.BAD_REQUEST;
      }
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
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
