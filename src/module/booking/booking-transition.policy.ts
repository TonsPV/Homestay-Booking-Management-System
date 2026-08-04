import { HttpStatus, Injectable } from '@nestjs/common';

import { AppHttpException, ErrorCode } from '../../common/http';
import {
  Booking,
  BookingPaymentStatus,
  BookingStatus,
} from './schema/booking.entity';
import { RoomStatus } from '../room/schema/room.entity';

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

export const BOOKING_TRANSITION_REASON_CODES = [
  ErrorCode.BOOKING_REFUND_PENDING,
  ErrorCode.BOOKING_TRANSITION_NOT_ALLOWED,
  ErrorCode.BOOKING_CONFIRMATION_REQUIRES_PAYMENT,
  ErrorCode.BOOKING_CHECKIN_REQUIRES_PAYMENT,
  ErrorCode.BOOKING_CHECKIN_OUTSIDE_STAY_WINDOW,
  ErrorCode.BOOKING_ROOM_NOT_FOUND,
  ErrorCode.BOOKING_ROOM_NOT_READY,
  ErrorCode.BOOKING_CANCELLATION_ALREADY_PAID,
] as const;

export type BookingTransitionReasonCode =
  (typeof BOOKING_TRANSITION_REASON_CODES)[number];

export interface BookingTransitionCapability {
  targetStatus: BookingStatus;
  allowed: boolean;
  reasonCode: BookingTransitionReasonCode | null;
}

export interface BookingTransitionContext {
  refundPending?: boolean;
  roomExists?: boolean;
  roomStatus?: RoomStatus | null;
  currentDate?: string;
}

@Injectable()
export class BookingTransitionPolicy {
  getCapabilities(
    booking: Booking,
    context: BookingTransitionContext = {},
  ): BookingTransitionCapability[] {
    return Object.values(BookingStatus).map((targetStatus) =>
      this.evaluate(booking, targetStatus, context),
    );
  }

  evaluate(
    booking: Booking,
    targetStatus: BookingStatus,
    context: BookingTransitionContext = {},
  ): BookingTransitionCapability {
    if (booking.status === targetStatus) {
      return this.allowed(targetStatus);
    }

    if (context.refundPending === true) {
      return this.denied(targetStatus, ErrorCode.BOOKING_REFUND_PENDING);
    }

    if (!MANAGEMENT_STATUS_TRANSITIONS[booking.status].includes(targetStatus)) {
      return this.denied(
        targetStatus,
        ErrorCode.BOOKING_TRANSITION_NOT_ALLOWED,
      );
    }

    if (
      targetStatus === BookingStatus.CONFIRMED &&
      booking.paymentStatus === BookingPaymentStatus.UNPAID &&
      booking.createdByUserId === null
    ) {
      return this.denied(
        targetStatus,
        ErrorCode.BOOKING_CONFIRMATION_REQUIRES_PAYMENT,
      );
    }

    if (
      targetStatus === BookingStatus.CHECKED_IN &&
      booking.paymentStatus !== BookingPaymentStatus.PAID
    ) {
      return this.denied(
        targetStatus,
        ErrorCode.BOOKING_CHECKIN_REQUIRES_PAYMENT,
      );
    }

    if (
      targetStatus === BookingStatus.CHECKED_IN &&
      !this.isInsideStayWindow(booking, context.currentDate)
    ) {
      return this.denied(
        targetStatus,
        ErrorCode.BOOKING_CHECKIN_OUTSIDE_STAY_WINDOW,
      );
    }

    if (
      targetStatus === BookingStatus.CHECKED_IN ||
      targetStatus === BookingStatus.CHECKED_OUT
    ) {
      if (context.roomExists === false) {
        return this.denied(targetStatus, ErrorCode.BOOKING_ROOM_NOT_FOUND);
      }

      if (
        targetStatus === BookingStatus.CHECKED_IN &&
        context.roomStatus !== undefined &&
        context.roomStatus !== RoomStatus.READY
      ) {
        return this.denied(targetStatus, ErrorCode.BOOKING_ROOM_NOT_READY);
      }
    }

    if (
      targetStatus === BookingStatus.CANCELLED &&
      booking.paymentStatus === BookingPaymentStatus.PAID
    ) {
      return this.denied(
        targetStatus,
        ErrorCode.BOOKING_CANCELLATION_ALREADY_PAID,
      );
    }

    return this.allowed(targetStatus);
  }

  assertAllowed(
    booking: Booking,
    capability: BookingTransitionCapability,
  ): void {
    if (capability.allowed || capability.reasonCode === null) {
      return;
    }

    throw new AppHttpException(
      HttpStatus.CONFLICT,
      capability.reasonCode,
      this.messageFor(capability.reasonCode, booking, capability.targetStatus),
    );
  }

  private allowed(targetStatus: BookingStatus): BookingTransitionCapability {
    return { targetStatus, allowed: true, reasonCode: null };
  }

  private denied(
    targetStatus: BookingStatus,
    reasonCode: BookingTransitionReasonCode,
  ): BookingTransitionCapability {
    return { targetStatus, allowed: false, reasonCode };
  }

  private isInsideStayWindow(
    booking: Booking,
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
    reasonCode: BookingTransitionReasonCode,
    booking: Booking,
    targetStatus: BookingStatus,
  ): string {
    switch (reasonCode) {
      case ErrorCode.BOOKING_REFUND_PENDING:
        return 'Booking dang co yeu cau hoan tien VNPay cho doi soat.';
      case ErrorCode.BOOKING_CONFIRMATION_REQUIRES_PAYMENT:
        return 'Booking online chi duoc xac nhan sau khi thanh toan.';
      case ErrorCode.BOOKING_CHECKIN_REQUIRES_PAYMENT:
        return 'Booking phai duoc thanh toan truoc khi check-in.';
      case ErrorCode.BOOKING_CHECKIN_OUTSIDE_STAY_WINDOW:
        return 'Chi co the check-in trong thoi gian luu tru cua booking.';
      case ErrorCode.BOOKING_ROOM_NOT_FOUND:
        return 'Phong cua booking khong con ton tai.';
      case ErrorCode.BOOKING_ROOM_NOT_READY:
        return 'Phong phai o trang thai READY truoc khi check-in.';
      case ErrorCode.BOOKING_CANCELLATION_ALREADY_PAID:
        return 'Booking da thanh toan. Can hoan tien truoc khi huy.';
      case ErrorCode.BOOKING_TRANSITION_NOT_ALLOWED:
      default:
        return `Khong the chuyen booking tu ${booking.status} sang ${targetStatus}.`;
    }
  }
}
