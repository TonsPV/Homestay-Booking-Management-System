import { parse, resolve } from 'node:path';

import type { ConfigService } from '@nestjs/config';

import { resolveRoomImageUploadDirectory } from './room-image-storage';

describe('room image storage configuration', () => {
  it('resolves the default to a dedicated project subdirectory', () => {
    expect(resolveRoomImageUploadDirectory(createConfig())).toBe(
      resolve(process.cwd(), '.data/uploads/room-images'),
    );
  });

  it.each(['.', '..'])('rejects unsafe relative directory %s', (directory) => {
    expect(() =>
      resolveRoomImageUploadDirectory(createConfig(directory)),
    ).toThrow('ROOM_IMAGE_UPLOAD_DIR');
  });

  it('rejects a filesystem root', () => {
    expect(() =>
      resolveRoomImageUploadDirectory(createConfig(parse(process.cwd()).root)),
    ).toThrow('ROOM_IMAGE_UPLOAD_DIR');
  });
});

function createConfig(uploadDirectory?: string): Pick<ConfigService, 'get'> {
  return {
    get: jest.fn((key: string) =>
      key === 'ROOM_IMAGE_UPLOAD_DIR' ? uploadDirectory : undefined,
    ),
  };
}
