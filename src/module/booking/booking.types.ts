import { BookingPaymentStatus, BookingStatus } from './schema/booking.entity';
import type { BookingTransitionCapability } from './booking-transition.policy';
import type { CustomerCredentialCapabilities } from '../customer/customer-credential.policy';

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
  credentialCapabilities: CustomerCredentialCapabilities;
  transitionCapabilities: BookingTransitionCapability[];
}
