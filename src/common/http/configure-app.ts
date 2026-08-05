import { randomUUID } from 'node:crypto';

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { NextFunction, Response } from 'express';

import {
  ROOM_IMAGE_PUBLIC_PATH,
  resolveRoomImageUploadDirectory,
} from '../../config/room-image-storage';
import { ApiResponseInterceptor } from './api-response.interceptor';
import type { AppRequest } from './auth.types';
import { HttpExceptionFilter } from './http-exception.filter';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

export function configureApp(app: INestApplication): void {
  const configService = app.get(ConfigService);
  const corsOrigins = configService.get<string[]>('CORS_ORIGINS') ?? [];
  const nodeEnvironment =
    configService.get<string>('NODE_ENV')?.toLowerCase() ?? 'development';
  const expressApp = app as NestExpressApplication;

  if (nodeEnvironment === 'production' && corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS must be configured in production.');
  }

  expressApp.use(helmet());
  expressApp.use(
    (request: AppRequest, response: Response, next: NextFunction): void => {
      const suppliedRequestId = request.header('x-request-id')?.trim();
      const requestId =
        suppliedRequestId !== undefined &&
        REQUEST_ID_PATTERN.test(suppliedRequestId)
          ? suppliedRequestId
          : randomUUID();

      request.requestId = requestId;
      response.setHeader('X-Request-Id', requestId);
      next();
    },
  );

  if (typeof expressApp.useBodyParser === 'function') {
    expressApp.useBodyParser('json', {
      limit: configService.get<string>('HTTP_JSON_BODY_LIMIT') ?? '1mb',
    });
    expressApp.useBodyParser('urlencoded', {
      extended: true,
      limit: configService.get<string>('HTTP_URLENCODED_BODY_LIMIT') ?? '1mb',
    });
  }

  expressApp.useStaticAssets(resolveRoomImageUploadDirectory(configService), {
    dotfiles: 'deny',
    // RoomImageStorageService writes a fresh UUID filename for every upload
    // and never overwrites an existing object, so long-lived immutable caching
    // is safe for the managed image URLs.
    immutable: true,
    index: false,
    maxAge: 31_536_000_000,
    prefix: `${ROOM_IMAGE_PUBLIC_PATH}/`,
    setHeaders: (response: Response) => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
    },
  });

  app.setGlobalPrefix('api');
  app.enableCors({
    exposedHeaders: ['Retry-After', 'X-Request-Id'],
    origin: corsOrigins.length === 0 ? true : corsOrigins,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
}
