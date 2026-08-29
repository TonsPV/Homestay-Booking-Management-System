import { RoomStatusTransitionPolicy } from '../../../../src/module/room/domain/room-status-transition.policy';
import { RoomStatus } from '../../../../src/module/room/domain/room-status';
import {
  CheckedInRoomMustRemainOccupiedError,
  RoomHiddenStatusPermissionError,
  RoomOccupancyRequiresCheckedInBookingError,
} from '../../../../src/module/room/domain/room.errors';

describe('RoomStatusTransitionPolicy', () => {
  const policy = new RoomStatusTransitionPolicy();

  it.each(Object.values(RoomStatus))(
    'allows ADMIN to repair a checked-in Room from %s to OCCUPIED',
    (currentStatus) => {
      expect(() =>
        policy.assertAllowed({
          currentStatus,
          nextStatus: RoomStatus.OCCUPIED,
          role: 'ADMIN',
          hasCheckedInBooking: true,
        }),
      ).not.toThrow();
    },
  );

  it.each(
    Object.values(RoomStatus).filter(
      (status) => status !== RoomStatus.OCCUPIED,
    ),
  )('rejects leaving OCCUPIED semantics for checked-in Booking: %s', (next) => {
    expect(() =>
      policy.assertAllowed({
        currentStatus: RoomStatus.OCCUPIED,
        nextStatus: next,
        role: 'ADMIN',
        hasCheckedInBooking: true,
      }),
    ).toThrow(CheckedInRoomMustRemainOccupiedError);
  });

  it.each(Object.values(RoomStatus))(
    'rejects %s -> OCCUPIED when no Booking is checked in',
    (currentStatus) => {
      expect(() =>
        policy.assertAllowed({
          currentStatus,
          nextStatus: RoomStatus.OCCUPIED,
          role: 'ADMIN',
          hasCheckedInBooking: false,
        }),
      ).toThrow(RoomOccupancyRequiresCheckedInBookingError);
    },
  );

  it.each([
    RoomStatus.READY,
    RoomStatus.CLEANING,
    RoomStatus.MAINTENANCE,
    RoomStatus.HIDDEN,
  ])('allows ADMIN to repair orphan OCCUPIED -> %s', (nextStatus) => {
    expect(() =>
      policy.assertAllowed({
        currentStatus: RoomStatus.OCCUPIED,
        nextStatus,
        role: 'ADMIN',
        hasCheckedInBooking: false,
      }),
    ).not.toThrow();
  });

  it.each([RoomStatus.READY, RoomStatus.CLEANING, RoomStatus.MAINTENANCE])(
    'keeps valid non-occupancy same-state %s idempotent',
    (status) => {
      expect(() =>
        policy.assertAllowed({
          currentStatus: status,
          nextStatus: status,
          role: 'STAFF',
          hasCheckedInBooking: false,
        }),
      ).not.toThrow();
    },
  );

  it('keeps valid OCCUPIED same-state idempotent while a Booking is checked in', () => {
    expect(() =>
      policy.assertAllowed({
        currentStatus: RoomStatus.OCCUPIED,
        nextStatus: RoomStatus.OCCUPIED,
        role: 'STAFF',
        hasCheckedInBooking: true,
      }),
    ).not.toThrow();
  });

  it.each([
    {
      currentStatus: RoomStatus.READY,
      nextStatus: RoomStatus.HIDDEN,
    },
    {
      currentStatus: RoomStatus.HIDDEN,
      nextStatus: RoomStatus.READY,
    },
    {
      currentStatus: RoomStatus.HIDDEN,
      nextStatus: RoomStatus.HIDDEN,
    },
  ])(
    'preserves the STAFF HIDDEN boundary: $currentStatus -> $nextStatus',
    ({ currentStatus, nextStatus }) => {
      expect(() =>
        policy.assertAllowed({
          currentStatus,
          nextStatus,
          role: 'STAFF',
          hasCheckedInBooking: false,
        }),
      ).toThrow(RoomHiddenStatusPermissionError);
    },
  );
});
