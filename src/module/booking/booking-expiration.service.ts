import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { BookingService } from './booking.service';

@Injectable()
export class BookingExpirationService {
  private readonly logger = new Logger(BookingExpirationService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly bookingService: BookingService,
    configService: ConfigService,
  ) {
    this.enabled =
      configService.get<boolean>('EXPIRATION_SCHEDULERS_ENABLED') !== false;
  }

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'expire-pending-bookings',
    waitForCompletion: true,
  })
  async expirePendingBookings(): Promise<void> {
    if (!this.enabled) {
      this.logger.log(
        JSON.stringify({
          event: 'booking_expiration_skipped',
          reason: 'disabled',
        }),
      );
      return;
    }

    const startedAt = Date.now();

    try {
      const expiredCount = await this.bookingService.expirePendingPayments();

      this.logger.log(
        JSON.stringify({
          event: 'booking_expiration_completed',
          expiredCount,
          durationMs: Date.now() - startedAt,
        }),
      );
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'booking_expiration_failed',
          durationMs: Date.now() - startedAt,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      throw error;
    }
  }
}
