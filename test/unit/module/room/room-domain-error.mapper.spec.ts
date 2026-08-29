import { ConflictException, ForbiddenException } from '@nestjs/common';

import { throwMappedRoomDomainError } from '../../../../src/module/room/room-domain-error.mapper';
import {
  CheckedInRoomMustRemainOccupiedError,
  RoomHiddenStatusPermissionError,
  RoomOccupancyRequiresCheckedInBookingError,
} from '../../../../src/module/room/domain/room.errors';

describe('room domain error HTTP mapping', () => {
  it('maps the HIDDEN permission rule to the existing 403 exception', () => {
    expect(() =>
      throwMappedRoomDomainError(new RoomHiddenStatusPermissionError()),
    ).toThrow(ForbiddenException);
  });

  it.each([
    new CheckedInRoomMustRemainOccupiedError(),
    new RoomOccupancyRequiresCheckedInBookingError(),
  ])('maps occupancy rules to the existing 409 exception', (error) => {
    expect(() => throwMappedRoomDomainError(error)).toThrow(ConflictException);
  });
});
