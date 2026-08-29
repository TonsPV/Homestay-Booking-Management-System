import { ConflictException, ForbiddenException } from '@nestjs/common';

import {
  CheckedInRoomMustRemainOccupiedError,
  RoomHiddenStatusPermissionError,
  RoomOccupancyRequiresCheckedInBookingError,
} from './domain/room.errors';

export function throwMappedRoomDomainError(error: unknown): never {
  if (error instanceof RoomHiddenStatusPermissionError) {
    throw new ForbiddenException(error.message);
  }

  if (
    error instanceof CheckedInRoomMustRemainOccupiedError ||
    error instanceof RoomOccupancyRequiresCheckedInBookingError
  ) {
    throw new ConflictException(error.message);
  }

  throw error;
}
