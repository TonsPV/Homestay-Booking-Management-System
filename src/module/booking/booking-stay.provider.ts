import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BookingStayPolicy } from './domain/booking-stay.policy';

export const BOOKING_STAY_POLICY_PROVIDER: Provider = {
  provide: BookingStayPolicy,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): BookingStayPolicy =>
    new BookingStayPolicy(
      configService.getOrThrow<number>('BOOKING_MAX_ADVANCE_DAYS'),
    ),
};
