import { ApiPropertyOptional } from '@nestjs/swagger';

export class RefundPaymentDto {
  @ApiPropertyOptional({
    example: 'Customer requested a refund.',
    maxLength: 500,
    type: String,
  })
  reason?: unknown;
}
