import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { requiredPhone } from '../../common/validation';
import {
  CustomerClaimSmsDeliveryStatus,
  type CustomerClaimSmsDeliveryResult,
  CustomerClaimSmsProvider,
} from './customer-claim-sms.provider';

export interface SendCustomerClaimOtpInput {
  phone: string;
  otp: string;
  challengeId: string;
}

@Injectable()
export class CustomerClaimSmsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly smsProvider: CustomerClaimSmsProvider,
  ) {}

  isEnabled(): boolean {
    return (
      this.configService.get<boolean>('CUSTOMER_CLAIM_SMS_ENABLED') === true
    );
  }

  async sendOtp(
    input: SendCustomerClaimOtpInput,
  ): Promise<CustomerClaimSmsDeliveryResult> {
    if (!this.isEnabled()) {
      return {
        status: CustomerClaimSmsDeliveryStatus.REJECTED,
        providerMessageId: null,
        reason: 'feature_disabled',
      };
    }

    const phone = requiredPhone(input.phone);
    if (!/^[0-9]{6}$/.test(input.otp)) {
      throw new BadRequestException('OTP must contain exactly six digits.');
    }

    const challengeId = input.challengeId.trim();
    if (challengeId.length === 0 || challengeId.length > 100) {
      throw new BadRequestException('Challenge id is invalid.');
    }

    const lifetimeMinutes = this.configService.getOrThrow<number>(
      'CUSTOMER_CLAIM_OTP_LIFETIME_MINUTES',
    );

    return this.smsProvider.send({
      phone,
      correlationId: challengeId,
      message: this.buildMessage(input.otp, lifetimeMinutes),
    });
  }

  private buildMessage(otp: string, lifetimeMinutes: number): string {
    return (
      `HBMS: Ma xac minh cua ban la ${otp}. ` +
      `Ma co hieu luc trong ${lifetimeMinutes} phut. ` +
      'Khong chia se ma nay.'
    );
  }
}
