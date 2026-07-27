import { ApiProperty } from '@nestjs/swagger';

export class RoomCalendarRangeQueryDto {
  @ApiProperty({ example: '2030-08-01', format: 'date', type: String })
  from?: unknown;

  @ApiProperty({ example: '2030-09-01', format: 'date', type: String })
  to?: unknown;
}
