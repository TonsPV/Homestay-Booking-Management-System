import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class CancelBookingDto {
  @ApiPropertyOptional({
    example: 'Khách thay đổi kế hoạch.',
    maxLength: 500,
    type: String,
  })
  @Allow()
  reason?: unknown;
}
