import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { PaymentMethod, PaymentStatus } from '../schema/payment.entity';

export class ListPaymentsQueryDto {
  @ApiPropertyOptional({ default: 1, example: 1, minimum: 1, type: Number })
  @Allow()
  page?: unknown;

  @ApiPropertyOptional({
    default: 20,
    example: 20,
    maximum: 100,
    minimum: 1,
    type: Number,
  })
  @Allow()
  limit?: unknown;

  @ApiPropertyOptional({
    enum: PaymentStatus,
    example: PaymentStatus.SUCCESS,
    type: String,
  })
  @Allow()
  status?: unknown;

  @ApiPropertyOptional({
    enum: PaymentMethod,
    example: PaymentMethod.VNPAY,
    type: String,
  })
  @Allow()
  method?: unknown;
}
