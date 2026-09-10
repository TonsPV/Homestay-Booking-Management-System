import { ErrorCode } from '../../common/error-codes';
import { BookingTransitionDenialReason } from './domain/booking.errors';
import { BookingPaymentStatus, BookingStatus } from './domain/booking-state';

import type { CredentialCapabilities } from '../customer/customer.types';

export interface BookingAuditContext {
  requestId?: string;
}

export interface BookingResponse {
  id: string;
  bookingCode: string;
  customerId: string;
  roomId: string;
  createdByUserId: string | null;
  checkInDate: string;
  checkOutDate: string;
  guestCount: number;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  totalAmount: string;
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  paymentExpiresAt: Date | null;
  customerNote: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  customer: {
    id: string;
    fullName: string;
    phone: string;
  };
  room: {
    id: string;
    roomNumber: string;
    name: string;
    roomType: {
      id: string;
      name: string;
    };
  };
  createdByUser: {
    id: string;
    fullName: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ManagementBookingResponse extends BookingResponse {
  credentialCapabilities: CredentialCapabilities;
  transitionCapabilities: TransitionCapabilityResponse[];
}

export const TRANSITION_ERROR_CODES = {
  [BookingTransitionDenialReason.REFUND_PENDING]:
    ErrorCode.BOOKING_REFUND_PENDING,
  [BookingTransitionDenialReason.TRANSITION_NOT_ALLOWED]:
    ErrorCode.BOOKING_TRANSITION_NOT_ALLOWED,
  [BookingTransitionDenialReason.CONFIRMATION_REQUIRES_PAYMENT]:
    ErrorCode.BOOKING_CONFIRMATION_REQUIRES_PAYMENT,
  [BookingTransitionDenialReason.CHECKIN_REQUIRES_PAYMENT]:
    ErrorCode.BOOKING_CHECKIN_REQUIRES_PAYMENT,
  [BookingTransitionDenialReason.CHECKIN_OUTSIDE_STAY_WINDOW]:
    ErrorCode.BOOKING_CHECKIN_OUTSIDE_STAY_WINDOW,
  [BookingTransitionDenialReason.ROOM_MISSING_FOR_BOOKING]:
    ErrorCode.BOOKING_ROOM_MISSING_FOR_BOOKING,
  [BookingTransitionDenialReason.ROOM_NOT_READY]:
    ErrorCode.BOOKING_ROOM_NOT_READY,
  [BookingTransitionDenialReason.CANCELLATION_ALREADY_PAID]:
    ErrorCode.BOOKING_CANCELLATION_ALREADY_PAID,
} as const satisfies Record<BookingTransitionDenialReason, ErrorCode>;

export const BOOKING_TRANSITION_REASON_CODES = Object.values(
  TRANSITION_ERROR_CODES,
);

export type BookingTransitionReasonCode =
  (typeof TRANSITION_ERROR_CODES)[BookingTransitionDenialReason];

export interface TransitionCapabilityResponse {
  targetStatus: BookingStatus;
  allowed: boolean;
  reasonCode: BookingTransitionReasonCode | null;
}
