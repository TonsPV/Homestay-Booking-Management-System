import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config } from 'dotenv';

import { assertSafeE2eEnvironment } from '../src/config/e2e-environment';

const environmentPath = resolve(process.cwd(), '.env.test');

if (!existsSync(environmentPath)) {
  throw new Error(
    'Missing .env.test. Create it from .env.test.example before running E2E tests.',
  );
}

const result = config({
  path: environmentPath,
  override: true,
  quiet: true,
});

if (result.error !== undefined) {
  throw result.error;
}

process.env.ROOM_IMAGE_UPLOAD_DIR ||= '.data/test-uploads/room-images';

assertSafeE2eEnvironment(process.env);
