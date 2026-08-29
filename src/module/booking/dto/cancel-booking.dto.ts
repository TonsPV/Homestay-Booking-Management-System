import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CancelBookingDto {
  @ApiPropertyOptional({
    example: 'Khách thay đổi kế hoạch.',
    maxLength: 500,
    type: String,
  })
  @IsOptional()
  @IsString()
  reason?: string | null;
}
