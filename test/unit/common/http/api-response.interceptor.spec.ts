import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import { ApiResponse } from '../../../../src/common/http/api-response';
import { ApiResponseInterceptor } from '../../../../src/common/http/api-response.interceptor';

describe('ApiResponseInterceptor', () => {
  it('wraps a plain controller result with request context', async () => {
    const interceptor = new ApiResponseInterceptor();
    const result = await firstValueFrom(
      interceptor.intercept(createContext(200), {
        handle: () => of({ id: 'room-1' }),
      } as CallHandler),
    );

    expect(result).toMatchObject({
      success: true,
      statusCode: 200,
      message: 'Thanh cong.',
      data: { id: 'room-1' },
      path: '/api/v1/rooms/room-1',
      requestId: 'request-123',
      timestamp: expect.any(String) as string,
    });
  });

  it('preserves the explicit message, null data and pagination metadata', async () => {
    const interceptor = new ApiResponseInterceptor();
    const result = await firstValueFrom(
      interceptor.intercept(createContext(201), {
        handle: () =>
          of(
            ApiResponse.created(null, 'Da xu ly.', {
              pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
            }),
          ),
      } as CallHandler),
    );

    expect(result).toMatchObject({
      statusCode: 201,
      message: 'Da xu ly.',
      data: null,
      meta: {
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      },
    });
  });

  it('uses originalUrl and the safe request id fallback for shared metadata', async () => {
    const interceptor = new ApiResponseInterceptor();
    const result = await firstValueFrom(
      interceptor.intercept(createContext(200, { requestId: undefined }), {
        handle: () => of({ ok: true }),
      } as CallHandler),
    );

    expect(result).toMatchObject({
      path: '/api/v1/rooms/room-1',
      requestId: 'unknown',
    });
    expect(result.timestamp).toBe(new Date(result.timestamp).toISOString());
  });
});

function createContext(
  statusCode: number,
  requestOverrides: { requestId?: string } = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        originalUrl: '/api/v1/rooms/room-1',
        url: '/api/v1/rooms/room-1?ignored=true',
        requestId: 'request-123',
        ...requestOverrides,
      }),
      getResponse: () => ({ statusCode }),
    }),
  } as unknown as ExecutionContext;
}
