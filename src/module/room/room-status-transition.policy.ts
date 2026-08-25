import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import type { UserRole } from '../../common/domain/account.enums';
import { RoomStatus } from './schema/room.entity';

export interface RoomStatusTransitionContext {
  currentStatus: RoomStatus;
  nextStatus: RoomStatus;
  role: UserRole | undefined;
  hasCheckedInBooking: boolean;
}

@Injectable()
export class RoomStatusTransitionPolicy {
  assertAllowed(context: RoomStatusTransitionContext): void {
    this.assertActorMayChangeHiddenStatus(context);
    this.assertOccupancyMatchesCheckedInBooking(context);
  }

  private assertActorMayChangeHiddenStatus(
    context: RoomStatusTransitionContext,
  ): void {
    if (context.role === 'ADMIN') {
      return;
    }

    if (
      context.role !== 'STAFF' ||
      context.currentStatus === RoomStatus.HIDDEN ||
      context.nextStatus === RoomStatus.HIDDEN
    ) {
      throw new ForbiddenException(
        'Chi admin duoc thay doi trang thai HIDDEN.',
      );
    }
  }

  private assertOccupancyMatchesCheckedInBooking(
    context: RoomStatusTransitionContext,
  ): void {
    if (
      context.hasCheckedInBooking &&
      context.nextStatus !== RoomStatus.OCCUPIED
    ) {
      throw new ConflictException(
        'Phong co booking dang CHECKED_IN va phai giu trang thai OCCUPIED.',
      );
    }

    if (
      !context.hasCheckedInBooking &&
      context.nextStatus === RoomStatus.OCCUPIED
    ) {
      throw new ConflictException(
        'Chi duoc chuyen phong sang OCCUPIED khi co booking dang CHECKED_IN.',
      );
    }
  }
}
