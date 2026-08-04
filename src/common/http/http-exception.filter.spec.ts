import {
  BadRequestException,
  HttpStatus,
  type ArgumentsHost,
  Logger,
} from '@nestjs/common';

import { AppHttpException } from './app-http-exception';
import { ErrorCode } from './error-codes';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps an expected HTTP exception to the shared error envelope', () => {
    const filter = new HttpExceptionFilter();
    const fixture = createHost();

    filter.catch(new BadRequestException(['field is required']), fixture.host);

    expect(fixture.status).toHaveBeenCalledWith(400);
    expect(fixture.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 400,
        errorCode: 'COMMON_VALIDATION_FAILED',
        message: ['field is required'],
        error: 'Bad Request',
        path: '/api/v1/example',
        requestId: 'request-456',
        timestamp: expect.any(String) as string,
      }),
    );
  });

  it('sanitizes unexpected responses and logs them with the request id', () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const filter = new HttpExceptionFilter();
    const fixture = createHost();

    filter.catch(
      new Error('mysql://admin:secret@database.internal/hbms'),
      fixture.host,
    );

    expect(fixture.status).toHaveBeenCalledWith(500);
    expect(fixture.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 500,
        errorCode: 'COMMON_INTERNAL_ERROR',
        message: 'Internal server error.',
        error: 'Internal Server Error',
        requestId: 'request-456',
      }),
    );
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('[requestId=request-456]'),
      expect.any(String),
    );
  });

  it('preserves a stable business error code from an application exception', () => {
    const filter = new HttpExceptionFilter();
    const fixture = createHost();

    filter.catch(
      new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_TRANSITION_NOT_ALLOWED,
        'Khong the chuyen booking.',
      ),
      fixture.host,
    );

    expect(fixture.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        errorCode: ErrorCode.BOOKING_TRANSITION_NOT_ALLOWED,
      }),
    );
  });

  it('passes through only structured application field errors and safe details', () => {
    const filter = new HttpExceptionFilter();
    const fixture = createHost();

    filter.catch(
      new AppHttpException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BOOKING_CANCELLATION_REASON_REQUIRED,
        'Ly do huy booking la bat buoc.',
        {
          details: { retryable: false },
          fieldErrors: {
            cancellationReason: [
              {
                errorCode: ErrorCode.BOOKING_CANCELLATION_REASON_REQUIRED,
                message: 'Ly do huy booking la bat buoc.',
              },
            ],
          },
        },
      ),
      fixture.host,
    );

    expect(fixture.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { retryable: false },
        fieldErrors: {
          cancellationReason: [
            {
              errorCode: ErrorCode.BOOKING_CANCELLATION_REASON_REQUIRED,
              message: 'Ly do huy booking la bat buoc.',
            },
          ],
        },
      }),
    );
  });

  it('rejects an unregistered exception code at the HTTP boundary', () => {
    const filter = new HttpExceptionFilter();
    const fixture = createHost();

    filter.catch(
      new (class extends BadRequestException {
        override getResponse() {
          return {
            error: 'Bad Request',
            errorCode: 'UNREGISTERED_INTERNAL_CODE',
            message: 'Unsafe internal condition.',
          };
        }
      })(),
      fixture.host,
    );

    expect(fixture.json).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: ErrorCode.COMMON_VALIDATION_FAILED,
      }),
    );
  });
});

function createHost(): {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        originalUrl: '/api/v1/example',
        requestId: 'request-456',
      }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}
