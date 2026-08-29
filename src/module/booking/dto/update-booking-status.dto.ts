import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

import { BookingStatus } from '../domain/booking-state';

export class UpdateBookingStatusDto {
  @ApiProperty({
    enum: BookingStatus,
    example: BookingStatus.CONFIRMED,
    type: String,
  })
  @IsEnum(BookingStatus)
  status!: BookingStatus;

  @ApiPropertyOptional({
    description:
      'Required when changing the booking from another status to CANCELLED.',
    example: 'Khách yêu cầu hủy tại quầy.',
    maxLength: 500,
    type: String,
  })
  @IsOptional()
  @IsString()
  cancellationReason?: string | null;
}
