import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { configureApp } from './configure-app';

describe('configureApp', () => {
  it('uses the configured CORS origin allowlist', () => {
    const configService = {
      get: jest
        .fn()
        .mockImplementation((key: string) =>
          key === 'CORS_ORIGINS'
            ? ['http://localhost:5173', 'https://app.example.com']
            : undefined,
        ),
    };
    const app = createApp(configService);

    configureApp(app.value);

    expect(app.enableCors).toHaveBeenCalledWith({
      exposedHeaders: ['Retry-After', 'X-Request-Id'],
      origin: ['http://localhost:5173', 'https://app.example.com'],
    });
  });

  it('allows development tools when no CORS allowlist is configured', () => {
    const configService = {
      get: jest
        .fn()
        .mockImplementation((key: string) =>
          key === 'CORS_ORIGINS' ? [] : undefined,
        ),
    };
    const app = createApp(configService);

    configureApp(app.value);

    expect(app.enableCors).toHaveBeenCalledWith({
      exposedHeaders: ['Retry-After', 'X-Request-Id'],
      origin: true,
    });
  });

  it('serves optimized room images with immutable cache settings', () => {
    const configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'CORS_ORIGINS') {
          return [];
        }

        if (key === 'ROOM_IMAGE_UPLOAD_DIR') {
          return '.data/test-room-images';
        }

        return undefined;
      }),
    };
    const app = createApp(configService);

    configureApp(app.value);

    expect(app.useStaticAssets).toHaveBeenCalledWith(
      expect.stringContaining('.data'),
      expect.objectContaining({
        immutable: true,
        prefix: '/media/room-images/',
      }),
    );
  });

  it('propagates a bounded request id to the response', () => {
    const configService = {
      get: jest
        .fn()
        .mockImplementation((key: string) =>
          key === 'CORS_ORIGINS' ? [] : undefined,
        ),
    };
    const app = createApp(configService);

    configureApp(app.value);

    type RequestIdMiddleware = (
      request: {
        header: (name: string) => string | undefined;
        requestId?: string;
      },
      response: { setHeader: jest.Mock },
      next: jest.Mock,
    ) => void;
    const useCalls = app.use.mock.calls as unknown as Array<
      [RequestIdMiddleware]
    >;
    const middleware = useCalls[1]?.[0];
    const request = {
      header: jest.fn().mockReturnValue('request-from-proxy'),
      requestId: undefined as string | undefined,
    };
    const response = { setHeader: jest.fn() };
    const next = jest.fn();

    expect(middleware).toBeDefined();
    middleware?.(request, response, next);

    expect(request.requestId).toBe('request-from-proxy');
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      'request-from-proxy',
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('replaces an unsafe request id instead of reflecting it', () => {
    const configService = {
      get: jest
        .fn()
        .mockImplementation((key: string) =>
          key === 'CORS_ORIGINS' ? [] : undefined,
        ),
    };
    const app = createApp(configService);

    configureApp(app.value);

    type RequestIdMiddleware = (
      request: {
        header: (name: string) => string | undefined;
        requestId?: string;
      },
      response: { setHeader: jest.Mock },
      next: jest.Mock,
    ) => void;
    const middleware = (
      app.use.mock.calls as unknown as Array<[RequestIdMiddleware]>
    )[1]?.[0];
    const request = {
      header: jest.fn().mockReturnValue('unsafe\r\ninjected-header: value'),
      requestId: undefined as string | undefined,
    };
    const response = { setHeader: jest.fn() };

    middleware?.(request, response, jest.fn());

    expect(request.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      request.requestId,
    );
  });
});

function createApp(configService: { get: jest.Mock }): {
  value: INestApplication;
  enableCors: jest.Mock;
  useStaticAssets: jest.Mock;
  use: jest.Mock;
} {
  const enableCors = jest.fn();
  const useStaticAssets = jest.fn();
  const use = jest.fn();
  const value = {
    get: jest.fn((token: unknown) => {
      if (token === ConfigService) {
        return configService;
      }

      throw new Error('Unexpected application dependency.');
    }),
    setGlobalPrefix: jest.fn(),
    enableCors,
    useStaticAssets,
    use,
    useGlobalInterceptors: jest.fn(),
    useGlobalFilters: jest.fn(),
    enableShutdownHooks: jest.fn(),
  } as unknown as INestApplication;

  return { value, enableCors, useStaticAssets, use };
}
