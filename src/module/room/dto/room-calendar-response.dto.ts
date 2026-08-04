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
