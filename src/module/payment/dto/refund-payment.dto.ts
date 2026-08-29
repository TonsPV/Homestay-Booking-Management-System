import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefundPaymentDto {
  @ApiPropertyOptional({
    example: 'Customer requested a refund.',
    maxLength: 500,
    type: String,
  })
  @IsOptional()
  @IsString()
  reason?: string | null;
}
