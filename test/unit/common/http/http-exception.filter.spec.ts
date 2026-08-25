import {
  BadRequestException,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  Logger,
} from '@nestjs/common';

import { AppHttpException } from '../../../../src/common/http/app-http-exception';
import { ErrorCode } from '../../../../src/common/error-codes';
import { HttpExceptionFilter } from '../../../../src/common/http/http-exception.filter';

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

  it('preserves a valid string message array', () => {
    const filter = new HttpExceptionFilter();
    const fixture = createHost();

    filter.catch(new BadRequestException(['a', 'b']), fixture.host);

    expect(fixture.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: ['a', 'b'] }),
    );
  });

  it('replaces a mixed message array instead of leaking an object', () => {
    const filter = new HttpExceptionFilter();
    const fixture = createHost();
    const secret = 'mixed-secret-value';

    filter.catch(new BadRequestException(['a', { secret }]), fixture.host);

    expect(fixture.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Request validation failed.' }),
    );
    expect(JSON.stringify(fixture.json.mock.calls)).not.toContain(secret);
  });

  it('uses the same safe fallback for an object-only message array', () => {
    const filter = new HttpExceptionFilter();
    const fixture = createHost();
    const secret = 'object-only-secret';

    filter.catch(new BadRequestException([{ secret }]), fixture.host);

    expect(fixture.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Request validation failed.' }),
    );
    expect(JSON.stringify(fixture.json.mock.calls)).not.toContain(secret);
  });

  it('preserves an empty string message array', () => {
    const filter = new HttpExceptionFilter();
    const fixture = createHost();

    filter.catch(new BadRequestException([]), fixture.host);

    expect(fixture.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: [] }),
    );
  });

  it('maps a generic Nest exception with a string response', () => {
    const filter = new HttpExceptionFilter();
    const fixture = createHost();

    filter.catch(
      new HttpException('Plain HTTP failure.', HttpStatus.BAD_REQUEST),
      fixture.host,
    );

    expect(fixture.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: ErrorCode.COMMON_VALIDATION_FAILED,
        message: 'Plain HTTP failure.',
        error: 'BAD_REQUEST',
      }),
    );
  });

  it('maps a generic Nest exception with an object response', () => {
    const filter = new HttpExceptionFilter();
    const fixture = createHost();

    filter.catch(
      new HttpException(
        { error: 'Custom failure', message: 'Custom HTTP message.' },
        HttpStatus.CONFLICT,
      ),
      fixture.host,
    );

    expect(fixture.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.CONFLICT,
        errorCode: ErrorCode.COMMON_CONFLICT,
        message: 'Custom HTTP message.',
        error: 'Custom failure',
      }),
    );
  });

  it('preserves a valid error code with a compatible fallback status', () => {
    const filter = new HttpExceptionFilter();
    const fixture = createHost();

    filter.catch(
      new HttpException(
        {
          error: 'Unprocessable Entity',
          errorCode: ErrorCode.COMMON_VALIDATION_FAILED,
          message: 'Validation failed.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
      fixture.host,
    );

    expect(fixture.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        errorCode: ErrorCode.COMMON_VALIDATION_FAILED,
      }),
    );
  });

  it('uses originalUrl and the safe request id fallback for shared metadata', () => {
    const filter = new HttpExceptionFilter();
    const fixture = createHost({ requestId: undefined });

    filter.catch(new BadRequestException('invalid request'), fixture.host);

    const [[body]] = fixture.json.mock.calls as [
      [
        {
          path: string;
          requestId: string;
          timestamp: string;
        },
      ],
    ];

    expect(body).toMatchObject({
      path: '/api/v1/example',
      requestId: 'unknown',
    });
    expect(body.timestamp).toBe(new Date(body.timestamp).toISOString());
  });

  it('sanitizes unexpected responses and logs them with the request id', () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const filter = new HttpExceptionFilter();
    const fixture = createHost();
    const secret = 'mysql://admin:secret@database.internal/hbms';

    filter.catch(new Error(`connection failed: ${secret}`), fixture.host);

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
    expect(logger).toHaveBeenCalledWith({
      event: 'unexpected_http_exception',
      requestId: 'request-456',
      method: 'GET',
      statusCode: 500,
      exceptionType: 'Error',
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain(secret);
  });

  it('maps body-parser size errors to a safe 413 envelope without an internal-error log', () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const filter = new HttpExceptionFilter();
    const fixture = createHost();

    filter.catch(
      {
        statusCode: 413,
        type: 'entity.too.large',
        message: 'request entity too large',
      },
      fixture.host,
    );

    expect(fixture.status).toHaveBeenCalledWith(413);
    expect(fixture.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 413,
        errorCode: ErrorCode.COMMON_PAYLOAD_TOO_LARGE,
        message: 'Request body too large.',
        error: 'PAYLOAD_TOO_LARGE',
      }),
    );
    expect(logger).not.toHaveBeenCalled();
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

  it('preserves the AppHttpException contract in the public envelope', () => {
    const filter = new HttpExceptionFilter();
    const fixture = createHost();
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

    filter.catch(exception, fixture.host);

    expect(fixture.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: HttpStatus.CONFLICT,
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
        error: 'CONFLICT',
        requestId: 'request-456',
      }),
    );
  });

  it('omits optional AppHttpException fields when they are absent', () => {
    const filter = new HttpExceptionFilter();
    const fixture = createHost();

    filter.catch(
      new AppHttpException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.CUSTOMER_CURRENT_PASSWORD_INVALID,
        'Mat khau hien tai khong dung.',
      ),
      fixture.host,
    );

    const [[body]] = fixture.json.mock.calls as [[Record<string, unknown>]];

    expect(body).toMatchObject({
      statusCode: HttpStatus.BAD_REQUEST,
      errorCode: ErrorCode.CUSTOMER_CURRENT_PASSWORD_INVALID,
      message: 'Mat khau hien tai khong dung.',
    });
    expect(body).not.toHaveProperty('details');
    expect(body).not.toHaveProperty('fieldErrors');
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

  it('rejects a registered exception code with an incompatible status', () => {
    const filter = new HttpExceptionFilter();
    const fixture = createHost();

    filter.catch(
      new (class extends BadRequestException {
        override getResponse() {
          return {
            error: 'Bad Request',
            errorCode: ErrorCode.BOOKING_ROOM_NOT_FOUND,
            message: 'Room status mismatch.',
          };
        }
      })(),
      fixture.host,
    );

    expect(fixture.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: ErrorCode.COMMON_VALIDATION_FAILED,
      }),
    );
  });
});

function createHost(requestOverrides: { requestId?: string } = {}): {
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
        url: '/api/v1/example?ignored=true',
        requestId: 'request-456',
        ...requestOverrides,
      }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}
