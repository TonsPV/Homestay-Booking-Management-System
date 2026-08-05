import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { ListBookingsQueryDto } from './list-bookings-query.dto';

export class ListManagementBookingsQueryDto extends ListBookingsQueryDto {
  @ApiPropertyOptional({ example: 'BKMR', type: String })
  @Allow()
  search?: unknown;

  @ApiPropertyOptional({
    example: '2',
    pattern: '^[1-9][0-9]*$',
    type: String,
  })
  @Allow()
  customerId?: unknown;

  @ApiPropertyOptional({
    example: '21',
    pattern: '^[1-9][0-9]*$',
    type: String,
  })
  @Allow()
  roomId?: unknown;
}
