import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { ConfigService } from '@nestjs/config';

export const ROOM_IMAGE_MAX_FILE_SIZE = 8 * 1024 * 1024;
export const ROOM_IMAGE_MAX_PIXELS = 25_000_000;
export const ROOM_IMAGE_MAX_EDGE = 2560;
export const ROOM_IMAGE_PUBLIC_PATH = '/media/room-images';

const DEFAULT_ROOM_IMAGE_UPLOAD_DIR = '.data/uploads/room-images';

export function resolveRoomImageDir(
  configService: Pick<ConfigService, 'get'>,
): string {
  const configuredDirectory =
    configService.get<string>('ROOM_IMAGE_UPLOAD_DIR')?.trim() ||
    DEFAULT_ROOM_IMAGE_UPLOAD_DIR;
  const workingDirectory = resolve(process.cwd());
  const uploadDirectory = resolve(workingDirectory, configuredDirectory);

  if (
    isParentOrSame(uploadDirectory, workingDirectory) ||
    (!isAbsolute(configuredDirectory) &&
      !isParentOrSame(workingDirectory, uploadDirectory))
  ) {
    throw new Error(
      'ROOM_IMAGE_UPLOAD_DIR must be a dedicated subdirectory or an absolute directory outside the project tree.',
    );
  }

  return uploadDirectory;
}

function isParentOrSame(parent: string, child: string): boolean {
  const childPath = relative(parent, child);

  return (
    childPath === '' ||
    (childPath !== '..' &&
      !childPath.startsWith(`..${sep}`) &&
      !isAbsolute(childPath))
  );
}
