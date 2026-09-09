import {
  optionalNullableEmail,
  optionalNullableTrimmedString,
  optionalTrimmedString,
  requiredPhone,
  requireId,
  requirePositiveInt,
} from '../../../../common/validation';
import type { Customer } from '../../../customer/schema/customer.entity';
import type { Room } from '../../../room/schema/room.entity';
import type { CreateBookingDto } from '../../dto/create-booking.dto';
import type { CreateBookingInput } from '../../ports/booking-creation.store';
import type { Booking } from '../../schema/booking.entity';
import {
  BookingPaymentStatus,
  BookingRequestIntentActorType,
  BookingStatus,
} from '../../domain/booking-state';
import {
  calculateBookingTotalAmount,
  normalizeBookingStayRange,
} from '../../domain/booking-creation.policy';
import { BookingStayPolicy } from '../../domain/booking-stay.policy';

export interface BookingCreationInput {
  roomId: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  guestCount: number;
  contactName: string | undefined;
  contactPhone: string | undefined;
  contactEmail: string | null | undefined;
  customerNote: string | null;
}

export interface BookingRequestIntent {
  actorType: BookingRequestIntentActorType;
  actorId: string;
  key: string;
  hash: string;
}

interface BuildBookingInput {
  input: BookingCreationInput;
  customer: Customer;
  room: Room;
  createdByUserId: string | null;
  requestIntent: BookingRequestIntent | null;
  bookingCode: string;
  paymentExpiresAt: Date;
}

export function normalizeBookingCreationInput(
  body: CreateBookingDto,
  stayPolicy: BookingStayPolicy,
): BookingCreationInput {
  const stayRange = normalizeBookingStayRange(
    stayPolicy,
    body.checkInDate,
    body.checkOutDate,
  );

  return {
    roomId: requireId(body.roomId, 'Room'),
    checkInDate: stayRange.checkInDate,
    checkOutDate: stayRange.checkOutDate,
    nights: stayRange.nights,
    guestCount: requirePositiveInt(
      body.guestCount,
      'So luong khach khong hop le.',
    ),
    contactName: optionalTrimmedString(
      body.contactName,
      'Ten nguoi lien he khong hop le.',
      120,
    ),
    contactPhone:
      body.contactPhone === undefined
        ? undefined
        : requiredPhone(body.contactPhone),
    contactEmail: optionalNullableEmail(body.contactEmail),
    customerNote:
      optionalNullableTrimmedString(
        body.customerNote,
        'Ghi chu booking khong hop le.',
        10000,
      ) ?? null,
  };
}

export function buildBookingCreateInput(
  data: BuildBookingInput,
): CreateBookingInput {
  const { input, customer, room, requestIntent } = data;

  return {
    bookingCode: data.bookingCode,
    customerId: customer.id,
    roomId: room.id,
    createdByUserId: data.createdByUserId,
    checkInDate: input.checkInDate,
    checkOutDate: input.checkOutDate,
    guestCount: input.guestCount,
    contactName: input.contactName ?? customer.fullName,
    contactPhone: input.contactPhone ?? requiredPhone(customer.phone),
    contactEmail:
      input.contactEmail === undefined ? customer.email : input.contactEmail,
    totalAmount: calculateBookingTotalAmount(
      room.roomType.basePrice,
      input.nights,
    ),
    status: BookingStatus.PENDING_PAYMENT,
    paymentStatus: BookingPaymentStatus.UNPAID,
    paymentExpiresAt: data.paymentExpiresAt,
    customerNote: input.customerNote,
    cancelledAt: null,
    cancellationReason: null,
    requestIntentActorType: requestIntent?.actorType ?? null,
    requestIntentActorId: requestIntent?.actorId ?? null,
    requestIntentKey: requestIntent?.key ?? null,
    requestIntentHash: requestIntent?.hash ?? null,
  };
}

export function buildRoomCalendarReservationDates(
  input: BookingCreationInput,
  stayPolicy: BookingStayPolicy,
): string[] {
  return stayPolicy.enumerateStayDates(input.checkInDate, input.checkOutDate);
}

export function buildBookingCreatedAuditMetadata(
  booking: Booking,
): Record<string, string> {
  return {
    status: booking.status,
    roomId: booking.roomId,
    checkInDate: booking.checkInDate,
    checkOutDate: booking.checkOutDate,
  };
}
