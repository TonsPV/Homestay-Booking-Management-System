import { type INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';

jest.mock('@nestjs/swagger', () => {
  const actual =
    jest.requireActual<typeof import('@nestjs/swagger')>('@nestjs/swagger');

  return {
    ...actual,
    SwaggerModule: {
      ...actual.SwaggerModule,
      createDocument: jest.fn(() => ({})),
      setup: jest.fn(),
    },
  };
});

import { configureOpenApi, configureOpenApiIfEnabled } from './openapi';

describe('OpenAPI runtime gating', () => {
  const app = {} as INestApplication;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not register docs when SWAGGER_ENABLED is false', () => {
    const setup = jest.spyOn(SwaggerModule, 'setup');
    const configService = {
      getOrThrow: jest.fn().mockReturnValue(false),
    };

    expect(configureOpenApiIfEnabled(app, configService)).toBe(false);
    expect(setup).not.toHaveBeenCalled();
  });

  it('registers docs with persistence disabled in production', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const setup = jest.mocked(SwaggerModule.setup);
    const configService = {
      getOrThrow: jest
        .fn()
        .mockReturnValueOnce(true)
        .mockReturnValueOnce('production'),
    };

    expect(configureOpenApiIfEnabled(app, configService)).toBe(true);
    expect(setup).toHaveBeenCalledWith(
      'api/docs',
      app,
      {},
      expect.objectContaining({
        jsonDocumentUrl: 'api/docs-json',
        swaggerOptions: { persistAuthorization: false },
      }),
    );
  });

  it('defaults direct OpenAPI configuration to non-persistent authorization', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const setup = jest.mocked(SwaggerModule.setup);

    configureOpenApi(app);

    expect(setup).toHaveBeenCalledWith(
      'api/docs',
      app,
      {},
      expect.objectContaining({
        swaggerOptions: { persistAuthorization: false },
      }),
    );
  });
});
