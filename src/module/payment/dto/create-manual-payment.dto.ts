import { ApiProperty } from '@nestjs/swagger';

import { PaymentMethod } from '../schema/payment.entity';

export class CreateManualPaymentDto {
  @ApiProperty({
    enum: [PaymentMethod.CASH, PaymentMethod.BANK_TRANSFER],
    example: PaymentMethod.CASH,
    type: String,
  })
  method?: unknown;
}
