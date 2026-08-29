import type { UserRole } from '../../../common/domain/account.enums';
import {
  CheckedInRoomMustRemainOccupiedError,
  RoomHiddenStatusPermissionError,
  RoomOccupancyRequiresCheckedInBookingError,
} from './room.errors';
import { RoomStatus } from './room-status';

export interface RoomStatusTransitionContext {
  currentStatus: RoomStatus;
  nextStatus: RoomStatus;
  role: UserRole | undefined;
  hasCheckedInBooking: boolean;
}

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
      throw new RoomHiddenStatusPermissionError();
    }
  }

  private assertOccupancyMatchesCheckedInBooking(
    context: RoomStatusTransitionContext,
  ): void {
    if (
      context.hasCheckedInBooking &&
      context.nextStatus !== RoomStatus.OCCUPIED
    ) {
      throw new CheckedInRoomMustRemainOccupiedError();
    }

    if (
      !context.hasCheckedInBooking &&
      context.nextStatus === RoomStatus.OCCUPIED
    ) {
      throw new RoomOccupancyRequiresCheckedInBookingError();
    }
  }
}
