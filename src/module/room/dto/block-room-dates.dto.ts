import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class BlockRoomDatesDto {
  @ApiProperty({ example: '2030-08-01', format: 'date', type: String })
  @Allow()
  from?: unknown;

  @ApiProperty({ example: '2030-08-04', format: 'date', type: String })
  @Allow()
  to?: unknown;

  @ApiProperty({ example: 'Bao tri may lanh', maxLength: 500, type: String })
  @Allow()
  reason?: unknown;
}
