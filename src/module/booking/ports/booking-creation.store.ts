import type { TransactionContext } from '../../../common/application/transaction';
import type { Customer } from '../../customer/schema/customer.entity';
import type { Room } from '../../room/schema/room.entity';
import type { Booking } from '../schema/booking.entity';
import {
  BookingPaymentStatus,
  BookingRequestIntentActorType,
  BookingStatus,
} from '../domain/booking-state';

export interface CreateBookingInput {
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
  requestIntentActorType: BookingRequestIntentActorType | null;
  requestIntentActorId: string | null;
  requestIntentKey: string | null;
  requestIntentHash: string | null;
}

export interface BookingRequestIntentLookup {
  actorType: BookingRequestIntentActorType;
  actorId: string;
  key: string;
}

export type BookingCreationConflictKind = 'REQUEST_INTENT' | 'OTHER';

export class BookingCreationConflictError extends Error {
  constructor(readonly kind: BookingCreationConflictKind) {
    super(`Booking creation persistence conflict: ${kind}`);
    this.name = BookingCreationConflictError.name;
  }
}

export type CustomerIdentityConflictKind = 'PHONE' | 'EMAIL' | 'OTHER';

export class CustomerIdentityConflictError extends Error {
  constructor(readonly kind: CustomerIdentityConflictKind) {
    super(`Customer identity persistence conflict: ${kind}`);
    this.name = CustomerIdentityConflictError.name;
  }
}

export abstract class BookingCreationStore {
  abstract findRequestIntent(
    context: TransactionContext,
    lookup: BookingRequestIntentLookup,
  ): Promise<Booking | null>;

  abstract findRequestIntentSnapshot(
    lookup: BookingRequestIntentLookup,
  ): Promise<Booking | null>;

  abstract countActiveUnpaid(
    context: TransactionContext,
    customerId: string,
  ): Promise<number>;

  abstract findActiveUnpaidStayRanges(
    context: TransactionContext,
    customerId: string,
  ): Promise<Array<Pick<Booking, 'checkInDate' | 'checkOutDate'>>>;

  abstract createBooking(
    context: TransactionContext,
    input: CreateBookingInput,
  ): Promise<Booking>;
}

export interface NewPasswordlessCustomer {
  fullName: string;
  email: string | null;
  phone: string;
}

export abstract class BookingCustomerStore {
  abstract findById(
    context: TransactionContext,
    customerId: string,
    lockForAdmission: boolean,
  ): Promise<Customer | null>;

  abstract findByPhoneVariants(
    context: TransactionContext,
    phones: string[],
  ): Promise<Customer | null>;

  abstract findByEmail(
    context: TransactionContext,
    email: string,
  ): Promise<Customer | null>;

  abstract createPasswordless(
    context: TransactionContext,
    input: NewPasswordlessCustomer,
  ): Promise<Customer>;
}

export abstract class BookingRoomStore {
  abstract findBookableForUpdate(
    context: TransactionContext,
    roomId: string,
  ): Promise<Room | null>;
}
