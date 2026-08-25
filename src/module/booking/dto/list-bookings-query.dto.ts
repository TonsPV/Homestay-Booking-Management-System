import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';
import { BookingStatus } from '../schema/booking.entity';

export class ListBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: BookingStatus,
    example: BookingStatus.CONFIRMED,
    type: String,
  })
  @Allow()
  status?: unknown;
}
