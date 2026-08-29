import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';

import { configureApp } from '../../../../src/bootstrap/configure-app';

const IMAGE_PATH = '/media/room-images/7/probe.webp';

describe('static room image responses', () => {
  let app: INestApplication;
  let uploadDirectory: string;

  beforeAll(async () => {
    uploadDirectory = await mkdtemp(
      join(tmpdir(), 'hbms-static-room-image-test-'),
    );
    await mkdir(join(uploadDirectory, '7'), { recursive: true });
    await writeFile(join(uploadDirectory, '7', 'probe.webp'), 'test image');

    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'NODE_ENV') {
          return 'test';
        }

        if (key === 'CORS_ORIGINS') {
          return ['http://localhost:5173'];
        }

        if (key === 'ROOM_IMAGE_UPLOAD_DIR') {
          return uploadDirectory;
        }

        if (
          key === 'HTTP_JSON_BODY_LIMIT' ||
          key === 'HTTP_URLENCODED_BODY_LIMIT'
        ) {
          return '1mb';
        }

        return undefined;
      }),
    };

    const moduleDefinition = {
      module: class StaticRoomImageTestModule {},
      providers: [{ provide: ConfigService, useValue: configService }],
    };

    app = await NestFactory.create(moduleDefinition, {
      bodyParser: false,
      logger: false,
    });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await rm(uploadDirectory, { force: true, recursive: true });
  });

  it.each([
    ['same-origin request', undefined],
    ['allowed frontend origin', 'http://localhost:5173'],
    ['disallowed origin', 'https://evil.example'],
  ])(
    '%s receives a static image with scoped asset headers',
    async (_, origin) => {
      const imageRequest = request(app.getHttpServer() as Server).get(
        IMAGE_PATH,
      );

      if (origin !== undefined) {
        imageRequest.set('Origin', origin);
      }

      const response = await imageRequest.expect(200);

      expect(response.headers['cross-origin-resource-policy']).toBe(
        'cross-origin',
      );
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-type']).toMatch(/^image\/webp/);
    },
  );
});
