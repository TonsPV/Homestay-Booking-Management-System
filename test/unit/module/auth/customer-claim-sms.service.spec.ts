import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import {
  CustomerClaimSmsDeliveryStatus,
  type CustomerClaimSmsProvider,
} from '../../../../src/module/auth/customer-claim-sms.provider';
import { CustomerClaimSmsService } from '../../../../src/module/auth/customer-claim-sms.service';

describe('CustomerClaimSmsService', () => {
  let enabled: boolean;
  let send: jest.MockedFunction<CustomerClaimSmsProvider['send']>;
  let service: CustomerClaimSmsService;

  beforeEach(() => {
    enabled = true;
    send = jest.fn<CustomerClaimSmsProvider['send']>().mockResolvedValue({
      status: CustomerClaimSmsDeliveryStatus.ACCEPTED,
      providerMessageId: 'provider-message-1',
      reason: null,
    });
    const configService = {
      get: jest.fn((key: string) =>
        key === 'CUSTOMER_CLAIM_SMS_ENABLED' ? enabled : undefined,
      ),
      getOrThrow: jest.fn((key: string) => {
        if (key === 'CUSTOMER_CLAIM_OTP_LIFETIME_MINUTES') {
          return 5;
        }
        throw new Error(`Unexpected config key: ${key}`);
      }),
    };

    service = new CustomerClaimSmsService(
      configService as unknown as ConfigService,
      { send },
    );
  });

  it('normalizes the phone and sends the approved claim-only template', async () => {
    await expect(
      service.sendOtp({
        phone: '091 234 5678',
        otp: '123456',
        challengeId: 'challenge-1',
      }),
    ).resolves.toEqual({
      status: CustomerClaimSmsDeliveryStatus.ACCEPTED,
      providerMessageId: 'provider-message-1',
      reason: null,
    });

    expect(send).toHaveBeenCalledWith({
      phone: '+84912345678',
      correlationId: 'challenge-1',
      message:
        'HBMS: Ma xac minh cua ban la 123456. Ma co hieu luc trong 5 phut. Khong chia se ma nay.',
    });
    expect(send.mock.calls[0][0].message).not.toMatch(
      /booking|room|email|password/i,
    );
  });

  it('fails closed without calling a provider when the feature is disabled', async () => {
    enabled = false;

    await expect(
      service.sendOtp({
        phone: '0912345678',
        otp: '123456',
        challengeId: 'challenge-1',
      }),
    ).resolves.toEqual({
      status: CustomerClaimSmsDeliveryStatus.REJECTED,
      providerMessageId: null,
      reason: 'feature_disabled',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    { otp: '12345', challengeId: 'challenge-1' },
    { otp: '12345a', challengeId: 'challenge-1' },
    { otp: '123456', challengeId: '   ' },
  ])('rejects malformed internal delivery input %#', async (input) => {
    await expect(
      service.sendOtp({ phone: '0912345678', ...input }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(send).not.toHaveBeenCalled();
  });
});
