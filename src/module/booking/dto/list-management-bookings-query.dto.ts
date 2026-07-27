import { ApiPropertyOptional } from '@nestjs/swagger';

import { ListBookingsQueryDto } from './list-bookings-query.dto';

export class ListManagementBookingsQueryDto extends ListBookingsQueryDto {
  @ApiPropertyOptional({ example: 'BKMR', type: String })
  search?: unknown;

  @ApiPropertyOptional({
    example: '2',
    pattern: '^[1-9][0-9]*$',
    type: String,
  })
  customerId?: unknown;

  @ApiPropertyOptional({
    example: '21',
    pattern: '^[1-9][0-9]*$',
    type: String,
  })
  roomId?: unknown;
}
