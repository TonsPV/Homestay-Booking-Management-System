import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/http';
import { createOpenApiDocument } from '../src/openapi/openapi';

async function generateOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });

  try {
    configureApp(app);
    await app.init();

    const outputDirectory = resolve(process.cwd(), 'docs');
    const outputPath = resolve(outputDirectory, 'openapi.json');

    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(createOpenApiDocument(app), null, 2)}\n`,
      'utf8',
    );

    console.log(`OpenAPI snapshot written to ${outputPath}`);
  } finally {
    await app.close();
  }
}

void generateOpenApi();
