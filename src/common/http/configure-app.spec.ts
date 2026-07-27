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

    expect(app.enableCors).toHaveBeenCalledWith({ origin: true });
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
});

function createApp(configService: { get: jest.Mock }): {
  value: INestApplication;
  enableCors: jest.Mock;
  useStaticAssets: jest.Mock;
} {
  const enableCors = jest.fn();
  const useStaticAssets = jest.fn();
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
    useGlobalInterceptors: jest.fn(),
    useGlobalFilters: jest.fn(),
    enableShutdownHooks: jest.fn(),
  } as unknown as INestApplication;

  return { value, enableCors, useStaticAssets };
}
