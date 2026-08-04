import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { BookingStatus } from '../schema/booking.entity';

export class UpdateBookingStatusDto {
  @ApiProperty({
    enum: BookingStatus,
    example: BookingStatus.CONFIRMED,
    type: String,
  })
  status!: unknown;

  @ApiPropertyOptional({
    description:
      'Required when changing the booking from another status to CANCELLED.',
    example: 'Khách yêu cầu hủy tại quầy.',
    maxLength: 500,
    type: String,
  })
  cancellationReason?: unknown;
}
