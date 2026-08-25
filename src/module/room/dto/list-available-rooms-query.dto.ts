import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';

export class ListAvailableRoomsQueryDto extends PaginationQueryDto {
  @ApiProperty({ example: '2026-08-01', format: 'date', type: String })
  @Allow()
  checkIn?: unknown;

  @ApiProperty({ example: '2026-08-03', format: 'date', type: String })
  @Allow()
  checkOut?: unknown;

  @ApiProperty({ example: 2, minimum: 1, type: Number })
  @Allow()
  guests?: unknown;

  @ApiPropertyOptional({
    example: '5',
    pattern: '^[1-9][0-9]*$',
    type: String,
  })
  @Allow()
  roomTypeId?: unknown;
}
