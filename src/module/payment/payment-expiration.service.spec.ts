import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { PaymentExpirationService } from './payment-expiration.service';
import type { PaymentService } from './payment.service';

describe('PaymentExpirationService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs expired payments and stale refunds in one structured summary', async () => {
    const expirePendingOnlinePayments = jest.fn().mockResolvedValue(4);
    const countStaleRefunds = jest.fn().mockResolvedValue(1);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const service = createService(
      true,
      expirePendingOnlinePayments,
      countStaleRefunds,
    );

    await service.expirePendingOnlinePayments();

    expect(expirePendingOnlinePayments).toHaveBeenCalledTimes(1);
    expect(countStaleRefunds).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      event: 'payment_expiration_completed',
      expiredCount: 4,
      staleRefundCount: 1,
      durationMs: expect.any(Number) as number,
    });
  });

  it('does not run expiration or stale-refund queries when disabled', async () => {
    const expirePendingOnlinePayments = jest.fn();
    const countStaleRefunds = jest.fn();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const service = createService(
      false,
      expirePendingOnlinePayments,
      countStaleRefunds,
    );

    await service.expirePendingOnlinePayments();

    expect(expirePendingOnlinePayments).not.toHaveBeenCalled();
    expect(countStaleRefunds).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      event: 'payment_expiration_skipped',
      reason: 'disabled',
    });
  });

  it('keeps internal error details out of structured failure logs', async () => {
    const internalMessage =
      'connect ECONNREFUSED mysql://admin:secret@database.internal/hbms';
    const expirePendingOnlinePayments = jest
      .fn()
      .mockRejectedValue(new Error(internalMessage));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const service = createService(true, expirePendingOnlinePayments, jest.fn());

    await expect(service.expirePendingOnlinePayments()).rejects.toThrow(
      internalMessage,
    );

    expect(error).toHaveBeenCalledTimes(1);
    const serializedLog = String(error.mock.calls[0]?.[0]);
    expect(serializedLog).toContain('"event":"payment_expiration_failed"');
    expect(serializedLog).toContain('"errorType":"Error"');
    expect(serializedLog).not.toContain(internalMessage);
    expect(serializedLog).not.toContain('secret');
    expect(error.mock.calls[0]).toHaveLength(1);
  });
});

function createService(
  enabled: boolean,
  expirePendingOnlinePayments: jest.Mock,
  countStaleRefunds: jest.Mock,
) {
  return new PaymentExpirationService(
    {
      expirePendingOnlinePayments,
      countStaleRefunds,
    } as unknown as PaymentService,
    {
      get: jest.fn(() => enabled),
    } as unknown as ConfigService,
  );
}
