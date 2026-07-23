import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import type { ApiErrorResponse } from './api-response';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (!(exception instanceof HttpException)) {
      this.logUnexpectedException(exception, request);
    }

    const body: ApiErrorResponse = {
      success: false,
      statusCode,
      message: this.getMessage(exception),
      error: this.getError(exception, statusCode),
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(body);
  }

  private logUnexpectedException(exception: unknown, request: Request): void {
    const context = `${request.method} ${request.originalUrl}`;

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
}
