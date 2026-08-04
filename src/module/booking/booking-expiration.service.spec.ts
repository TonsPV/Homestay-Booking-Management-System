import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { BookingExpirationService } from './booking-expiration.service';
import type { BookingService } from './booking.service';

describe('BookingExpirationService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs a structured completion summary when enabled', async () => {
    const expirePendingPayments = jest.fn().mockResolvedValue(2);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const service = createService(true, expirePendingPayments);

    await service.expirePendingBookings();

    expect(expirePendingPayments).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      event: 'booking_expiration_completed',
      expiredCount: 2,
      durationMs: expect.any(Number) as number,
    });
  });

  it('does not mutate bookings when the scheduler is disabled', async () => {
    const expirePendingPayments = jest.fn();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const service = createService(false, expirePendingPayments);

    await service.expirePendingBookings();

    expect(expirePendingPayments).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      event: 'booking_expiration_skipped',
      reason: 'disabled',
    });
  });

  it('keeps internal error details out of structured failure logs', async () => {
    const internalMessage =
      'Query failed on mysql://admin:secret@database.internal/hbms';
    const expirePendingPayments = jest
      .fn()
      .mockRejectedValue(new Error(internalMessage));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const service = createService(true, expirePendingPayments);

    await expect(service.expirePendingBookings()).rejects.toThrow(
      internalMessage,
    );

    expect(error).toHaveBeenCalledTimes(1);
    const serializedLog = String(error.mock.calls[0]?.[0]);
    expect(serializedLog).toContain('"event":"booking_expiration_failed"');
    expect(serializedLog).toContain('"errorType":"Error"');
    expect(serializedLog).not.toContain(internalMessage);
    expect(serializedLog).not.toContain('secret');
    expect(error.mock.calls[0]).toHaveLength(1);
  });
});

function createService(enabled: boolean, expirePendingPayments: jest.Mock) {
  return new BookingExpirationService(
    { expirePendingPayments } as unknown as BookingService,
    {
      get: jest.fn(() => enabled),
    } as unknown as ConfigService,
  );
}
