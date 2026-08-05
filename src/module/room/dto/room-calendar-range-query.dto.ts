import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class RoomCalendarRangeQueryDto {
  @ApiProperty({ example: '2030-08-01', format: 'date', type: String })
  @Allow()
  from?: unknown;

  @ApiProperty({ example: '2030-09-01', format: 'date', type: String })
  @Allow()
  to?: unknown;
}
