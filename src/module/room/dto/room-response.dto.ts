import { ApiProperty } from '@nestjs/swagger';

import { RoomCalendarStatus } from '../../booking/domain/room-calendar-status';
import { RoomStatus } from '../domain/room-status';
import { RoomTodayAvailabilityStatus } from '../room.types';
import { RoomTypeAmenityDto } from '../../room-type/dto/room-type-response.dto';
import { BedType } from '../../room-type/bed-configuration';
import { RoomTypeBedResponseDto } from '../../room-type/dto/room-type-bed.dto';

export class RoomImageDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: '/uploads/rooms/room-1.jpg' })
  imageUrl!: string;

  @ApiProperty({ example: 0, minimum: 0 })
  sortOrder!: number;

  @ApiProperty({ example: true })
  isCover!: boolean;
}

export class RoomResponseRoomTypeDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'Deluxe Room' })
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({
    deprecated: true,
    description: 'Legacy free-text bed configuration. Use beds instead.',
    example: '1 giường đôi',
    nullable: true,
    type: String,
  })
  bedType!: string | null;

  @ApiProperty({ type: [RoomTypeBedResponseDto] })
  beds!: Array<{ type: BedType; quantity: number }>;

  @ApiProperty({ example: 2, minimum: 1 })
  maxGuests!: number;

  @ApiProperty({ example: '1500000.00' })
  basePrice!: string;

  @ApiProperty({ type: [RoomTypeAmenityDto] })
  amenities!: RoomTypeAmenityDto[];
}

export class PublicRoomDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: '1' })
  roomTypeId!: string;

  @ApiProperty({ example: 'Deluxe Room' })
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ type: RoomResponseRoomTypeDto })
  roomType!: RoomResponseRoomTypeDto;

  @ApiProperty({ type: [RoomImageDto] })
  images!: RoomImageDto[];
}

export class RoomDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: '1' })
  roomTypeId!: string;

  @ApiProperty({ example: '101' })
  roomNumber!: string;

  @ApiProperty({ example: 'Deluxe 101' })
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ enum: RoomStatus, enumName: 'RoomStatus' })
  status!: RoomStatus;

  @ApiProperty({ type: RoomResponseRoomTypeDto })
  roomType!: RoomResponseRoomTypeDto;

  @ApiProperty({ type: [RoomImageDto] })
  images!: RoomImageDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

class ManagementRoomCalendarBookingDto {
  @ApiProperty({ example: '28' })
  id!: string;

  @ApiProperty({ example: 'BKMRZ123ABC' })
  bookingCode!: string;

  @ApiProperty({ example: '2030-08-01', format: 'date' })
  checkInDate!: string;

  @ApiProperty({ example: '2030-08-03', format: 'date' })
  checkOutDate!: string;
}

class ManagementRoomCalendarEventDto {
  @ApiProperty({ example: '2030-08-01', format: 'date' })
  stayDate!: string;

  @ApiProperty({ enum: RoomCalendarStatus })
  status!: RoomCalendarStatus;

  @ApiProperty({ nullable: true, type: String })
  reason!: string | null;

  @ApiProperty({ nullable: true, type: ManagementRoomCalendarBookingDto })
  booking!: ManagementRoomCalendarBookingDto | null;
}

class ManagementRoomCalendarSummaryDto {
  @ApiProperty({ example: '2030-08-01', format: 'date' })
  asOfDate!: string;

  @ApiProperty({
    enum: RoomTodayAvailabilityStatus,
    enumName: 'RoomTodayAvailabilityStatus',
  })
  todayStatus!: RoomTodayAvailabilityStatus;

  @ApiProperty({ nullable: true, type: ManagementRoomCalendarEventDto })
  nextEvent!: ManagementRoomCalendarEventDto | null;
}

export class ManagementRoomDto extends RoomDto {
  @ApiProperty({ type: ManagementRoomCalendarSummaryDto })
  calendarSummary!: ManagementRoomCalendarSummaryDto;
}
