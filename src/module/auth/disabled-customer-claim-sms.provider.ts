import {
  CustomerClaimSmsDeliveryStatus,
  type CustomerClaimSmsDeliveryResult,
  CustomerClaimSmsProvider,
} from './customer-claim-sms.provider';

export class DisabledCustomerClaimSmsProvider extends CustomerClaimSmsProvider {
  send(): Promise<CustomerClaimSmsDeliveryResult> {
    return Promise.resolve({
      status: CustomerClaimSmsDeliveryStatus.REJECTED,
      providerMessageId: null,
      reason: 'provider_disabled',
    });
  }
}
