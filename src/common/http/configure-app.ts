import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Response } from 'express';

import {
  ROOM_IMAGE_PUBLIC_PATH,
  resolveRoomImageUploadDirectory,
} from '../../config/room-image-storage';
import { ApiResponseInterceptor } from './api-response.interceptor';
import { HttpExceptionFilter } from './http-exception.filter';

export function configureApp(app: INestApplication): void {
  const configService = app.get(ConfigService);
  const corsOrigins = configService.get<string[]>('CORS_ORIGINS') ?? [];
  const expressApp = app as NestExpressApplication;

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
    origin: corsOrigins.length === 0 ? true : corsOrigins,
  });
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
}
