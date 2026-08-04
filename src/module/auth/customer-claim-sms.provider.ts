export enum CustomerClaimSmsDeliveryStatus {
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  UNKNOWN = 'UNKNOWN',
}

export interface CustomerClaimSmsDeliveryRequest {
  phone: string;
  message: string;
  correlationId: string;
}

export interface CustomerClaimSmsDeliveryResult {
  status: CustomerClaimSmsDeliveryStatus;
  providerMessageId: string | null;
  reason: string | null;
}

export abstract class CustomerClaimSmsProvider {
  abstract send(
    request: CustomerClaimSmsDeliveryRequest,
  ): Promise<CustomerClaimSmsDeliveryResult>;
}
