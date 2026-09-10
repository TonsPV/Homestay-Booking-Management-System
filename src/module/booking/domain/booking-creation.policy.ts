import {
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { ErrorCode } from '../../../common/error-codes';
import { AppHttpException } from '../../../common/http/app-http-exception';
import type { Customer } from '../../customer/schema/customer.entity';
import { RoomStatus } from '../../room/domain/room-status';
import type { Room } from '../../room/schema/room.entity';
import { throwMappedBookingDomainError } from '../booking-domain-error.mapper';
import type { BookingStayRange } from './booking-stay.policy';
import { BookingStayPolicy } from './booking-stay.policy';

const MAX_TOTAL_CENTS = 999_999_999_999n;

export function normalizeBookingStayRange(
  stayPolicy: BookingStayPolicy,
  checkIn: unknown,
  checkOut: unknown,
): BookingStayRange {
  try {
    return stayPolicy.normalizeStayRange(checkIn, checkOut);
  } catch (error) {
    throwMappedBookingDomainError(error);
  }
}

export function assertBookingStayAllowed(
  stayPolicy: BookingStayPolicy,
  stayRange: BookingStayRange,
  now: Date,
): void {
  try {
    stayPolicy.assertWithinBookingWindow(stayRange, now);
  } catch (error) {
    throwMappedBookingDomainError(error);
  }
}

export function assertGuestCapacity(
  guestCount: number,
  maxGuests: number,
): void {
  if (guestCount <= maxGuests) {
    return;
  }

  throw new AppHttpException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.BOOKING_GUEST_CAPACITY_EXCEEDED,
    'So luong khach vuot qua suc chua cua loai phong.',
    {
      fieldErrors: {
        guestCount: [
          {
            errorCode: ErrorCode.BOOKING_GUEST_CAPACITY_EXCEEDED,
            message: 'So luong khach vuot qua suc chua cua loai phong.',
          },
        ],
      },
    },
  );
}

export function requireBookableRoom(room: Room | null): Room {
  if (room === null) {
    throw new AppHttpException(
      HttpStatus.NOT_FOUND,
      ErrorCode.BOOKING_ROOM_NOT_FOUND,
      'Khong tim thay phong.',
      {
        fieldErrors: {
          roomId: [
            {
              errorCode: ErrorCode.BOOKING_ROOM_NOT_FOUND,
              message: 'Khong tim thay phong.',
            },
          ],
        },
      },
    );
  }

  if (
    room.status === RoomStatus.HIDDEN ||
    room.status === RoomStatus.MAINTENANCE
  ) {
    throw new AppHttpException(
      HttpStatus.CONFLICT,
      ErrorCode.BOOKING_ROOM_NOT_BOOKABLE,
      'Phong hien khong the dat.',
      {
        fieldErrors: {
          roomId: [
            {
              errorCode: ErrorCode.BOOKING_ROOM_NOT_BOOKABLE,
              message: 'Phong hien khong the dat.',
            },
          ],
        },
      },
    );
  }

  return room;
}

export function assertActiveCustomer(
  customer: Customer | null,
  missingIsUnauthorized: boolean,
): Customer {
  if (customer === null) {
    if (missingIsUnauthorized) {
      throw new UnauthorizedException('Access token is invalid.');
    }

    throw new NotFoundException('Khong tim thay customer.');
  }

  if (customer.status === 'LOCKED') {
    throw new ForbiddenException('Tai khoan bi khoa.');
  }

  return customer;
}

export function requireCounterCustomerContact(
  contactName: string | undefined,
  contactPhone: string | undefined,
): { contactName: string; contactPhone: string } {
  if (contactName !== undefined && contactPhone !== undefined) {
    return { contactName, contactPhone };
  }

  throw new AppHttpException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.BOOKING_CUSTOMER_CONTACT_REQUIRED,
    'Contact name va contact phone la bat buoc khi tao khach tai quay.',
    {
      fieldErrors: {
        contactName: [
          {
            errorCode: ErrorCode.BOOKING_CUSTOMER_CONTACT_REQUIRED,
            message: 'Ten khach tai quay la bat buoc.',
          },
        ],
        contactPhone: [
          {
            errorCode: ErrorCode.BOOKING_CUSTOMER_CONTACT_REQUIRED,
            message: 'So dien thoai khach tai quay la bat buoc.',
          },
        ],
      },
    },
  );
}

export function assertActiveUnpaidLimit(
  activeUnpaidCount: number,
  maxUnpaidBookings: number,
): void {
  if (activeUnpaidCount < maxUnpaidBookings) {
    return;
  }

  throw new AppHttpException(
    HttpStatus.CONFLICT,
    ErrorCode.BOOKING_ACTIVE_UNPAID_LIMIT_REACHED,
    `Ban dang co toi da ${maxUnpaidBookings} booking cho thanh toan. Vui long thanh toan, huy hoac cho booking het han.`,
    { details: { limit: maxUnpaidBookings } },
  );
}

export function assertHeldNightsLimit(
  heldNights: number,
  requestedNights: number,
  maxHeldNights: number,
): void {
  if (heldNights + requestedNights <= maxHeldNights) {
    return;
  }

  throw new AppHttpException(
    HttpStatus.CONFLICT,
    ErrorCode.BOOKING_HELD_NIGHTS_LIMIT_REACHED,
    `Tong so dem dang giu va booking moi khong duoc vuot qua ${maxHeldNights} dem.`,
    { details: { limit: maxHeldNights } },
  );
}

export function calculateBookingTotalAmount(
  basePrice: string,
  nights: number,
): string {
  const match = /^([0-9]+)[.]([0-9]{2})$/.exec(basePrice);

  if (match === null) {
    throw new Error('Room type base price is invalid.');
  }

  const basePriceCents = BigInt(match[1]) * 100n + BigInt(match[2]);
  const totalCents = basePriceCents * BigInt(nights);

  if (totalCents > MAX_TOTAL_CENTS) {
    throw new AppHttpException(
      HttpStatus.CONFLICT,
      ErrorCode.BOOKING_TOTAL_LIMIT_EXCEEDED,
      'Tong tien booking vuot qua gioi han.',
    );
  }

  const wholeAmount = totalCents / 100n;
  const fractionalAmount = String(totalCents % 100n).padStart(2, '0');

  return `${wholeAmount}.${fractionalAmount}`;
}
