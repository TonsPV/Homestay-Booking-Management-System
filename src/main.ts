import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';
import { configureOpenApiIfEnabled } from './openapi/openapi';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  const configService = app.get(ConfigService);

  configureApp(app);

  configureOpenApiIfEnabled(app, configService);

  // Ưu tiên PORT của cloud provider (Render), sau đó mới tới APP_PORT của local env
  const port = Number(
    process.env.PORT ??
      configService.get<string>('PORT') ??
      configService.get<string>('APP_PORT') ??
      3000,
  );

  // Bắt buộc phải có '0.0.0.0' để container mở cổng ra môi trường bên ngoài
  await app.listen(port, '0.0.0.0');

  new Logger('Bootstrap').log(`Application listening on port ${port}.`);
}

void bootstrap();
