import { ApiPropertyOptional } from '@nestjs/swagger';

export class CancelBookingDto {
  @ApiPropertyOptional({
    example: 'Khách thay đổi kế hoạch.',
    maxLength: 500,
    type: String,
  })
  reason?: unknown;
}
