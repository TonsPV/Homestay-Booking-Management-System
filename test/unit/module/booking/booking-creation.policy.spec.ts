import { HttpStatus } from '@nestjs/common';

import { ErrorCode } from '../../../../src/common/error-codes';
import { AppHttpException } from '../../../../src/common/http/app-http-exception';
import {
  assertActiveUnpaidLimit,
  assertGuestCapacity,
  assertHeldNightsLimit,
  calculateBookingTotalAmount,
  requireBookableRoom,
} from '../../../../src/module/booking/domain/booking-creation.policy';
import { RoomStatus } from '../../../../src/module/room/domain/room-status';
import type { Room } from '../../../../src/module/room/schema/room.entity';

describe('booking creation policy', () => {
  it('accepts a guest count at room capacity', () => {
    expect(() => assertGuestCapacity(2, 2)).not.toThrow();
  });

  it('preserves the capacity error contract', () => {
    expectAppError(
      () => assertGuestCapacity(3, 2),
      HttpStatus.BAD_REQUEST,
      ErrorCode.BOOKING_GUEST_CAPACITY_EXCEEDED,
      'So luong khach vuot qua suc chua cua loai phong.',
    );
  });

  it('rejects a room that is not bookable', () => {
    expectAppError(
      () => requireBookableRoom(roomFixture(RoomStatus.MAINTENANCE)),
      HttpStatus.CONFLICT,
      ErrorCode.BOOKING_ROOM_NOT_BOOKABLE,
      'Phong hien khong the dat.',
    );
  });

  it('enforces active booking and held-night limits', () => {
    expectAppError(
      () => assertActiveUnpaidLimit(3, 3),
      HttpStatus.CONFLICT,
      ErrorCode.BOOKING_ACTIVE_UNPAID_LIMIT_REACHED,
      'Ban dang co toi da 3 booking cho thanh toan. Vui long thanh toan, huy hoac cho booking het han.',
    );
    expectAppError(
      () => assertHeldNightsLimit(29, 2, 30),
      HttpStatus.CONFLICT,
      ErrorCode.BOOKING_HELD_NIGHTS_LIMIT_REACHED,
      'Tong so dem dang giu va booking moi khong duoc vuot qua 30 dem.',
    );
  });

  it('calculates the exact decimal booking total', () => {
    expect(calculateBookingTotalAmount('1250000.50', 3)).toBe('3750001.50');
  });
});

function expectAppError(
  work: () => void,
  status: HttpStatus,
  errorCode: string,
  message: string,
): void {
  try {
    work();
    throw new Error('Expected booking creation policy to throw.');
  } catch (error) {
    expect(error).toBeInstanceOf(AppHttpException);
    expect(error).toMatchObject({ status, message });
    expect((error as AppHttpException).getResponse()).toMatchObject({
      errorCode,
    });
  }
}

function roomFixture(status: RoomStatus): Room {
  return { id: '1', status } as Room;
}
