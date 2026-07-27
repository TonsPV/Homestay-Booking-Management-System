import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PaymentService } from './payment.service';

@Injectable()
export class PaymentExpirationService {
  constructor(private readonly paymentService: PaymentService) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'expire-pending-online-payments',
    waitForCompletion: true,
  })
  async expirePendingOnlinePayments(): Promise<void> {
    await this.paymentService.expirePendingOnlinePayments();
  }
}
