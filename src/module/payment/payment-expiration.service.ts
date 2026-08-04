import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PaymentService } from './payment.service';

@Injectable()
export class PaymentExpirationService {
  private readonly logger = new Logger(PaymentExpirationService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly paymentService: PaymentService,
    configService: ConfigService,
  ) {
    this.enabled =
      configService.get<boolean>('EXPIRATION_SCHEDULERS_ENABLED') !== false;
  }

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'expire-pending-online-payments',
    waitForCompletion: true,
  })
  async expirePendingOnlinePayments(): Promise<void> {
    if (!this.enabled) {
      this.logger.log(
        JSON.stringify({
          event: 'payment_expiration_skipped',
          reason: 'disabled',
        }),
      );
      return;
    }

    const startedAt = Date.now();

    try {
      const [expiredCount, staleRefundCount] = await Promise.all([
        this.paymentService.expirePendingOnlinePayments(),
        this.paymentService.countStaleRefunds(),
      ]);

      this.logger.log(
        JSON.stringify({
          event: 'payment_expiration_completed',
          expiredCount,
          staleRefundCount,
          durationMs: Date.now() - startedAt,
        }),
      );
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'payment_expiration_failed',
          durationMs: Date.now() - startedAt,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      throw error;
    }
  }
}
