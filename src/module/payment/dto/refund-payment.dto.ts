import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class RefundPaymentDto {
  @ApiPropertyOptional({
    example: 'Customer requested a refund.',
    maxLength: 500,
    type: String,
  })
  @Allow()
  reason?: unknown;
}
