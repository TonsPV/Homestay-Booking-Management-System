import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';
import { PaymentMethod, PaymentStatus } from '../schema/payment.entity';

export class ListPaymentsQueryDto extends PaginationQueryDto {
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
