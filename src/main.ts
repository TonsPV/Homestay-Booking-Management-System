import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';
import { configureApp } from './common/http';
import { configureOpenApiIfEnabled } from './openapi/openapi';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  const configService = app.get(ConfigService);

  configureApp(app);

  configureOpenApiIfEnabled(app, configService);

  const port = Number(configService.get<string>('APP_PORT') ?? 3000);

  await app.listen(port);

  new Logger('Bootstrap').log(`Application listening on port ${port}.`);
}

void bootstrap();
