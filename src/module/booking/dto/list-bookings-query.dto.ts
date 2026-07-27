import { ApiPropertyOptional } from '@nestjs/swagger';

import { BookingStatus } from '../schema/booking.entity';

export class ListBookingsQueryDto {
  @ApiPropertyOptional({ default: 1, example: 1, minimum: 1, type: Number })
  page?: unknown;

  @ApiPropertyOptional({
    default: 20,
    example: 20,
    maximum: 100,
    minimum: 1,
    type: Number,
  })
  limit?: unknown;

  @ApiPropertyOptional({
    enum: BookingStatus,
    example: BookingStatus.CONFIRMED,
    type: String,
  })
  status?: unknown;
}
