import { RoomStatus } from '../../room/domain/room-status';
import {
  BookingTransitionDenialReason,
  BookingTransitionNotAllowedError,
} from './booking.errors';
import { BookingPaymentStatus, BookingStatus } from './booking-state';

const VIETNAM_UTC_OFFSET_MILLISECONDS = 7 * 60 * 60 * 1000;

export const MANAGEMENT_STATUS_TRANSITIONS: Readonly<
  Record<BookingStatus, readonly BookingStatus[]>
> = {
  [BookingStatus.PENDING_PAYMENT]: [
    BookingStatus.CONFIRMED,
    BookingStatus.CANCELLED,
  ],
  [BookingStatus.CONFIRMED]: [
    BookingStatus.CHECKED_IN,
    BookingStatus.CANCELLED,
  ],
  [BookingStatus.CHECKED_IN]: [BookingStatus.CHECKED_OUT],
  [BookingStatus.CHECKED_OUT]: [],
  [BookingStatus.CANCELLED]: [],
};

export interface BookingTransitionState {
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  createdByUserId: string | null;
  checkInDate: string;
  checkOutDate: string;
}

export interface BookingTransitionCapability {
  targetStatus: BookingStatus;
  allowed: boolean;
  reason: BookingTransitionDenialReason | null;
}

export interface BookingTransitionContext {
  refundPending?: boolean;
  roomExists?: boolean;
  roomStatus?: RoomStatus | null;
  currentDate?: string;
}

export class BookingTransitionPolicy {
  getCapabilities(
    booking: BookingTransitionState,
    context: BookingTransitionContext = {},
  ): BookingTransitionCapability[] {
    return Object.values(BookingStatus).map((targetStatus) =>
      this.evaluate(booking, targetStatus, context),
    );
  }

  evaluate(
    booking: BookingTransitionState,
    targetStatus: BookingStatus,
    context: BookingTransitionContext = {},
  ): BookingTransitionCapability {
    if (booking.status === targetStatus) {
      return this.allowed(targetStatus);
    }

    if (context.refundPending === true) {
      return this.denied(
        targetStatus,
        BookingTransitionDenialReason.REFUND_PENDING,
      );
    }

    if (!MANAGEMENT_STATUS_TRANSITIONS[booking.status].includes(targetStatus)) {
      return this.denied(
        targetStatus,
        BookingTransitionDenialReason.TRANSITION_NOT_ALLOWED,
      );
    }

    if (
      targetStatus === BookingStatus.CONFIRMED &&
      booking.paymentStatus === BookingPaymentStatus.UNPAID &&
      booking.createdByUserId === null
    ) {
      return this.denied(
        targetStatus,
        BookingTransitionDenialReason.CONFIRMATION_REQUIRES_PAYMENT,
      );
    }

    if (
      targetStatus === BookingStatus.CHECKED_IN &&
      booking.paymentStatus !== BookingPaymentStatus.PAID
    ) {
      return this.denied(
        targetStatus,
        BookingTransitionDenialReason.CHECKIN_REQUIRES_PAYMENT,
      );
    }

    if (
      targetStatus === BookingStatus.CHECKED_IN &&
      !this.isInsideStayWindow(booking, context.currentDate)
    ) {
      return this.denied(
        targetStatus,
        BookingTransitionDenialReason.CHECKIN_OUTSIDE_STAY_WINDOW,
      );
    }

    if (
      targetStatus === BookingStatus.CHECKED_IN ||
      targetStatus === BookingStatus.CHECKED_OUT
    ) {
      if (context.roomExists === false) {
        return this.denied(
          targetStatus,
          BookingTransitionDenialReason.ROOM_MISSING_FOR_BOOKING,
        );
      }

      if (
        targetStatus === BookingStatus.CHECKED_IN &&
        context.roomStatus !== undefined &&
        context.roomStatus !== RoomStatus.READY
      ) {
        return this.denied(
          targetStatus,
          BookingTransitionDenialReason.ROOM_NOT_READY,
        );
      }
    }

    if (
      targetStatus === BookingStatus.CANCELLED &&
      booking.paymentStatus === BookingPaymentStatus.PAID
    ) {
      return this.denied(
        targetStatus,
        BookingTransitionDenialReason.CANCELLATION_ALREADY_PAID,
      );
    }

    return this.allowed(targetStatus);
  }

  assertAllowed(
    booking: BookingTransitionState,
    capability: BookingTransitionCapability,
  ): void {
    if (capability.allowed || capability.reason === null) {
      return;
    }

    throw new BookingTransitionNotAllowedError(
      booking.status,
      capability.targetStatus,
      capability.reason,
      this.messageFor(capability.reason, booking, capability.targetStatus),
    );
  }

  private allowed(targetStatus: BookingStatus): BookingTransitionCapability {
    return { targetStatus, allowed: true, reason: null };
  }

  private denied(
    targetStatus: BookingStatus,
    reason: BookingTransitionDenialReason,
  ): BookingTransitionCapability {
    return { targetStatus, allowed: false, reason };
  }

  private isInsideStayWindow(
    booking: BookingTransitionState,
    currentDate = this.getCurrentVietnamDate(),
  ): boolean {
    return (
      currentDate >= booking.checkInDate && currentDate < booking.checkOutDate
    );
  }

  private getCurrentVietnamDate(now = new Date()): string {
    return new Date(now.getTime() + VIETNAM_UTC_OFFSET_MILLISECONDS)
      .toISOString()
      .slice(0, 10);
  }

  private messageFor(
    reason: BookingTransitionDenialReason,
    booking: BookingTransitionState,
    targetStatus: BookingStatus,
  ): string {
    switch (reason) {
      case BookingTransitionDenialReason.REFUND_PENDING:
        return 'Booking dang co yeu cau hoan tien VNPay cho doi soat.';
      case BookingTransitionDenialReason.CONFIRMATION_REQUIRES_PAYMENT:
        return 'Booking online chi duoc xac nhan sau khi thanh toan.';
      case BookingTransitionDenialReason.CHECKIN_REQUIRES_PAYMENT:
        return 'Booking phai duoc thanh toan truoc khi check-in.';
      case BookingTransitionDenialReason.CHECKIN_OUTSIDE_STAY_WINDOW:
        return 'Chi co the check-in trong thoi gian luu tru cua booking.';
      case BookingTransitionDenialReason.ROOM_MISSING_FOR_BOOKING:
        return 'Phong cua booking khong con ton tai.';
      case BookingTransitionDenialReason.ROOM_NOT_READY:
        return 'Phong phai o trang thai READY truoc khi check-in.';
      case BookingTransitionDenialReason.CANCELLATION_ALREADY_PAID:
        return 'Booking da thanh toan. Can hoan tien truoc khi huy.';
      case BookingTransitionDenialReason.TRANSITION_NOT_ALLOWED:
      default:
        return `Khong the chuyen booking tu ${booking.status} sang ${targetStatus}.`;
    }
  }
}
