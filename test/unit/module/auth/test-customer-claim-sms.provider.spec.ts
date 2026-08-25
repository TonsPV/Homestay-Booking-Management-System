import {
  CustomerClaimSmsDeliveryStatus,
  type CustomerClaimSmsDeliveryResult,
} from '../../../../src/module/auth/customer-claim-sms.provider';
import { TestCustomerClaimSmsProvider } from '../../../../src/module/auth/test-customer-claim-sms.provider';

describe('TestCustomerClaimSmsProvider', () => {
  let provider: TestCustomerClaimSmsProvider;

  beforeEach(() => {
    provider = new TestCustomerClaimSmsProvider();
  });

  it('records deterministic accepted deliveries without external I/O', async () => {
    await expect(provider.send(request('challenge-1'))).resolves.toEqual({
      status: CustomerClaimSmsDeliveryStatus.ACCEPTED,
      providerMessageId: 'test-sms-1',
      reason: null,
    });
    await expect(provider.send(request('challenge-2'))).resolves.toEqual({
      status: CustomerClaimSmsDeliveryStatus.ACCEPTED,
      providerMessageId: 'test-sms-2',
      reason: null,
    });

    expect(provider.getDeliveries()).toEqual([
      { ...request('challenge-1'), sequence: 1 },
      { ...request('challenge-2'), sequence: 2 },
    ]);
  });

  it('supports deterministic rejected and unknown provider outcomes', async () => {
    const rejected: CustomerClaimSmsDeliveryResult = {
      status: CustomerClaimSmsDeliveryStatus.REJECTED,
      providerMessageId: null,
      reason: 'fixture_rejected',
    };
    const unknown: CustomerClaimSmsDeliveryResult = {
      status: CustomerClaimSmsDeliveryStatus.UNKNOWN,
      providerMessageId: null,
      reason: 'fixture_timeout',
    };
    provider.queueResult(rejected);
    provider.queueResult(unknown);

    await expect(provider.send(request('challenge-1'))).resolves.toEqual(
      rejected,
    );
    await expect(provider.send(request('challenge-2'))).resolves.toEqual(
      unknown,
    );
    expect(provider.getDeliveries()).toHaveLength(2);
  });

  it('returns delivery copies and resets all deterministic state', async () => {
    await provider.send(request('challenge-1'));
    const deliveries = provider.getDeliveries();
    (deliveries[0] as { message: string }).message = 'mutated';

    expect(provider.getDeliveries()[0].message).toBe('message');
    provider.reset();
    expect(provider.getDeliveries()).toEqual([]);
    await expect(provider.send(request('challenge-2'))).resolves.toMatchObject({
      providerMessageId: 'test-sms-1',
    });
  });
});

function request(correlationId: string) {
  return {
    phone: '+84912345678',
    message: 'message',
    correlationId,
  };
}
