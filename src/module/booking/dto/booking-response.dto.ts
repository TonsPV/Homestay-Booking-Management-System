import { ApiProperty } from '@nestjs/swagger';

import { CustomerCredentialCapabilitiesDto } from '../../customer/dto/customer-credential-capabilities.dto';
import {
  BOOKING_TRANSITION_REASON_CODES,
  type BookingTransitionReasonCode,
} from '../booking.types';
import { BookingPaymentStatus, BookingStatus } from '../domain/booking-state';

export class BookingCustomerDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'Nguyen Van A' })
  fullName!: string;

  @ApiProperty({ example: '0912345678' })
  phone!: string;
}

export class BookingRoomTypeDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'Deluxe Room' })
  name!: string;
}

export class BookingRoomDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: '101' })
  roomNumber!: string;

  @ApiProperty({ example: 'Deluxe 101' })
  name!: string;

  @ApiProperty({ type: BookingRoomTypeDto })
  roomType!: BookingRoomTypeDto;
}

export class BookingUserDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'Staff One' })
  fullName!: string;
}

export class BookingDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'BK-20260727-ABC123' })
  bookingCode!: string;

  @ApiProperty({ example: '1' })
  customerId!: string;

  @ApiProperty({ example: '1' })
  roomId!: string;

  @ApiProperty({ example: '1', nullable: true, type: String })
  createdByUserId!: string | null;

  @ApiProperty({ example: '2026-07-28', format: 'date' })
  checkInDate!: string;

  @ApiProperty({ example: '2026-07-30', format: 'date' })
  checkOutDate!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  guestCount!: number;

  @ApiProperty({ example: 'Nguyen Van A' })
  contactName!: string;

  @ApiProperty({ example: '0912345678' })
  contactPhone!: string;

  @ApiProperty({
    example: 'guest@example.com',
    nullable: true,
    type: String,
  })
  contactEmail!: string | null;

  @ApiProperty({ example: '3000000.00' })
  totalAmount!: string;

  @ApiProperty({ enum: BookingStatus, enumName: 'BookingStatus' })
  status!: BookingStatus;

  @ApiProperty({
    enum: BookingPaymentStatus,
    enumName: 'BookingPaymentStatus',
  })
  paymentStatus!: BookingPaymentStatus;

  @ApiProperty({ format: 'date-time', nullable: true, type: Date })
  paymentExpiresAt!: Date | null;

  @ApiProperty({ nullable: true, type: String })
  customerNote!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: Date })
  cancelledAt!: Date | null;

  @ApiProperty({ nullable: true, type: String })
  cancellationReason!: string | null;

  @ApiProperty({ type: BookingCustomerDto })
  customer!: BookingCustomerDto;

  @ApiProperty({ type: BookingRoomDto })
  room!: BookingRoomDto;

  @ApiProperty({ type: BookingUserDto, nullable: true })
  createdByUser!: BookingUserDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class BookingTransitionCapabilityDto {
  @ApiProperty({ enum: BookingStatus, enumName: 'BookingStatus' })
  targetStatus!: BookingStatus;

  @ApiProperty({ example: true })
  allowed!: boolean;

  @ApiProperty({
    example: null,
    nullable: true,
    enum: [...BOOKING_TRANSITION_REASON_CODES, null],
  })
  reasonCode!: BookingTransitionReasonCode | null;
}

export class ManagementBookingDto extends BookingDto {
  @ApiProperty({ type: CustomerCredentialCapabilitiesDto })
  credentialCapabilities!: CustomerCredentialCapabilitiesDto;

  @ApiProperty({ type: BookingTransitionCapabilityDto, isArray: true })
  transitionCapabilities!: BookingTransitionCapabilityDto[];
}
