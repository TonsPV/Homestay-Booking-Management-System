import { ApiProperty } from '@nestjs/swagger';

import { RoomCalendarStatus } from '../../booking/schema/room-calendar.entity';

class RoomCalendarBookingDto {
  @ApiProperty({ example: '28' })
  id: string;

  @ApiProperty({ example: 'BKMRZ123ABC' })
  bookingCode: string;
}

export class RoomCalendarEntryDto {
  @ApiProperty({ example: '101' })
  id: string;

  @ApiProperty({ example: '2030-08-01', format: 'date' })
  stayDate: string;

  @ApiProperty({ enum: RoomCalendarStatus })
  status: RoomCalendarStatus;

  @ApiProperty({
    example: 'Bao tri may lanh',
    nullable: true,
    type: String,
  })
  reason: string | null;

  @ApiProperty({
    nullable: true,
    type: RoomCalendarBookingDto,
  })
  booking: RoomCalendarBookingDto | null;
}

export class UnblockRoomDatesDto {
  @ApiProperty({ example: 3, minimum: 0 })
  removedCount: number;
}

export class RoomCalendarEntriesEnvelopeDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'Lay lich phong quan ly thanh cong.' })
  message: string;

  @ApiProperty({ type: [RoomCalendarEntryDto] })
  data: RoomCalendarEntryDto[];

  @ApiProperty({ example: '/api/v1/management/rooms/21/calendar' })
  path: string;

  @ApiProperty({ example: '2026-07-27T04:00:00.000Z', format: 'date-time' })
  timestamp: string;
}

export class UnblockRoomDatesEnvelopeDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'Mo khoa lich phong thanh cong.' })
  message: string;

  @ApiProperty({ type: UnblockRoomDatesDto })
  data: UnblockRoomDatesDto;

  @ApiProperty({ example: '/api/v1/management/rooms/21/blocks' })
  path: string;

  @ApiProperty({ example: '2026-07-27T04:00:00.000Z', format: 'date-time' })
  timestamp: string;
}
