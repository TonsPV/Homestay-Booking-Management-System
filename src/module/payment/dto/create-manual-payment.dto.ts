import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import { PaymentMethod } from '../domain/payment-state';

export class CreateManualPaymentDto {
  @ApiProperty({
    enum: [PaymentMethod.CASH, PaymentMethod.BANK_TRANSFER],
    example: PaymentMethod.CASH,
    type: String,
  })
  @IsIn([PaymentMethod.CASH, PaymentMethod.BANK_TRANSFER])
  method?: PaymentMethod;
}
