import { ApiProperty } from '@nestjs/swagger';

export class RefundPaymentDto {
  @ApiProperty({
    example: 'Customer requested a refund.',
    maxLength: 500,
    type: String,
  })
  reason?: unknown;
}
