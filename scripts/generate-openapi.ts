import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/http';
import { createOpenApiDocument } from '../src/openapi/openapi';
import { assertOpenApiResponseSchemas } from '../src/openapi/openapi-contract';

async function generateOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    abortOnError: false,
    logger: false,
  });

  try {
    configureApp(app);

    const outputDirectory = resolve(process.cwd(), 'docs');
    const outputPath = resolve(outputDirectory, 'openapi.json');

    await mkdir(outputDirectory, { recursive: true });
    const document = createOpenApiDocument(app);

    assertOpenApiResponseSchemas(document);
    const serializedDocument = `${JSON.stringify(document, null, 2)}\n`;

    if (process.argv.includes('--check')) {
      const committedDocument = await readFile(outputPath, 'utf8');

      if (committedDocument !== serializedDocument) {
        throw new Error(
          'docs/openapi.json is stale. Run npm run openapi:generate and commit the result.',
        );
      }

      console.log('OpenAPI snapshot is current.');
      return;
    }

    await writeFile(outputPath, serializedDocument, 'utf8');

    console.log(`OpenAPI snapshot written to ${outputPath}`);
  } finally {
    await app.close();
  }
}

void generateOpenApi().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack : String(error);

  console.error(`OpenAPI generation failed:\n${message}`);
  process.exitCode = 1;
});
