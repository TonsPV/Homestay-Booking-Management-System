import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { BookingService } from './booking.service';

@Injectable()
export class BookingExpirationService {
  constructor(private readonly bookingService: BookingService) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'expire-pending-bookings',
    waitForCompletion: true,
  })
  async expirePendingBookings(): Promise<void> {
    await this.bookingService.expirePendingPayments();
  }
}
