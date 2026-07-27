import { ApiPropertyOptional } from '@nestjs/swagger';

import { PaymentMethod, PaymentStatus } from '../schema/payment.entity';

export class ListPaymentsQueryDto {
  @ApiPropertyOptional({ default: 1, example: 1, minimum: 1, type: Number })
  page?: unknown;

  @ApiPropertyOptional({
    default: 20,
    example: 20,
    maximum: 100,
    minimum: 1,
    type: Number,
  })
  limit?: unknown;

  @ApiPropertyOptional({
    enum: PaymentStatus,
    example: PaymentStatus.SUCCESS,
    type: String,
  })
  status?: unknown;

  @ApiPropertyOptional({
    enum: PaymentMethod,
    example: PaymentMethod.VNPAY,
    type: String,
  })
  method?: unknown;
}
