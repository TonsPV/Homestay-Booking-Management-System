import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { BookingStatus } from '../schema/booking.entity';

export class ListBookingsQueryDto {
  @ApiPropertyOptional({ default: 1, example: 1, minimum: 1, type: Number })
  @Allow()
  page?: unknown;

  @ApiPropertyOptional({
    default: 20,
    example: 20,
    maximum: 100,
    minimum: 1,
    type: Number,
  })
  @Allow()
  limit?: unknown;

  @ApiPropertyOptional({
    enum: BookingStatus,
    example: BookingStatus.CONFIRMED,
    type: String,
  })
  @Allow()
  status?: unknown;
}
