import { ApiProperty } from '@nestjs/swagger';

export class BlockRoomDatesDto {
  @ApiProperty({ example: '2030-08-01', format: 'date', type: String })
  from?: unknown;

  @ApiProperty({ example: '2030-08-04', format: 'date', type: String })
  to?: unknown;

  @ApiProperty({ example: 'Bao tri may lanh', maxLength: 500, type: String })
  reason?: unknown;
}
