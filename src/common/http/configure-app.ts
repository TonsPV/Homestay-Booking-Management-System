import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
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
  const expressApp = app as NestExpressApplication;

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

  expressApp.useStaticAssets(resolveRoomImageUploadDirectory(configService), {
    dotfiles: 'deny',
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
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
}
