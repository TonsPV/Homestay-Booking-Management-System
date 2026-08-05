import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const configuration = new DocumentBuilder()
    .setTitle('Homestay Booking Management System API')
    .setDescription(
      'HTTP contract for the HBMS customer and management applications.',
    )
    .setVersion('1.0.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    })
    .build();

  return SwaggerModule.createDocument(app, configuration, {
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });
}

export interface OpenApiRuntimeOptions {
  persistAuthorization?: boolean;
}

export function configureOpenApiIfEnabled(
  app: INestApplication,
  configService: Pick<ConfigService, 'getOrThrow'>,
): boolean {
  if (!configService.getOrThrow<boolean>('SWAGGER_ENABLED')) {
    return false;
  }

  configureOpenApi(app, {
    persistAuthorization:
      configService.getOrThrow<string>('NODE_ENV') !== 'production',
  });

  return true;
}

export function configureOpenApi(
  app: INestApplication,
  options: OpenApiRuntimeOptions = {},
): void {
  SwaggerModule.setup('api/docs', app, createOpenApiDocument(app), {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: {
      persistAuthorization: options.persistAuthorization ?? false,
    },
  });
}
