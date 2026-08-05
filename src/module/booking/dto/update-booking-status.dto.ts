import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { BookingStatus } from '../schema/booking.entity';

export class UpdateBookingStatusDto {
  @ApiProperty({
    enum: BookingStatus,
    example: BookingStatus.CONFIRMED,
    type: String,
  })
  @Allow()
  status!: unknown;

  @ApiPropertyOptional({
    description:
      'Required when changing the booking from another status to CANCELLED.',
    example: 'Khách yêu cầu hủy tại quầy.',
    maxLength: 500,
    type: String,
  })
  @Allow()
  cancellationReason?: unknown;
}
