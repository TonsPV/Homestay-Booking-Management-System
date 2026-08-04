import {
  CustomerClaimSmsDeliveryStatus,
  type CustomerClaimSmsDeliveryRequest,
  type CustomerClaimSmsDeliveryResult,
  CustomerClaimSmsProvider,
} from './customer-claim-sms.provider';

export interface TestCustomerClaimSmsDelivery extends CustomerClaimSmsDeliveryRequest {
  sequence: number;
}

export class TestCustomerClaimSmsProvider extends CustomerClaimSmsProvider {
  private readonly deliveries: TestCustomerClaimSmsDelivery[] = [];
  private readonly queuedResults: CustomerClaimSmsDeliveryResult[] = [];
  private sequence = 0;

  send(
    request: CustomerClaimSmsDeliveryRequest,
  ): Promise<CustomerClaimSmsDeliveryResult> {
    this.sequence += 1;
    this.deliveries.push({ ...request, sequence: this.sequence });

    const queued = this.queuedResults.shift();
    if (queued !== undefined) {
      return Promise.resolve({ ...queued });
    }

    return Promise.resolve({
      status: CustomerClaimSmsDeliveryStatus.ACCEPTED,
      providerMessageId: `test-sms-${this.sequence}`,
      reason: null,
    });
  }

  queueResult(result: CustomerClaimSmsDeliveryResult): void {
    this.queuedResults.push({ ...result });
  }

  getDeliveries(): readonly TestCustomerClaimSmsDelivery[] {
    return this.deliveries.map((delivery) => ({ ...delivery }));
  }

  reset(): void {
    this.deliveries.length = 0;
    this.queuedResults.length = 0;
    this.sequence = 0;
  }
}
