import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';
import { configureApp } from './common/http';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  configureApp(app);

  const port = Number(configService.get<string>('APP_PORT') ?? 3000);

  await app.listen(port);

  console.log(`Application is running at: http://localhost:${port}/api`);
}

void bootstrap();
