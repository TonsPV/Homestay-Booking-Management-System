import { ApiProperty } from '@nestjs/swagger';

export class CancelBookingDto {
  @ApiProperty({
    example: 'Khách thay đổi kế hoạch.',
    maxLength: 500,
    type: String,
  })
  reason?: unknown;
}
