import type { AccessTokenPayload } from '../../../../src/module/auth/auth.types';
import { PaymentMethod } from '../../../../src/module/payment/domain/payment-state';
import { PaymentManagementController } from '../../../../src/module/payment/payment-management.controller';
import { PaymentService } from '../../../../src/module/payment/payment.service';

describe('PaymentManagementController', () => {
  it('limits a staff payment-detail request to manual payment methods', async () => {
    const getManagementPayment = jest
      .fn()
      .mockResolvedValue({ id: 'payment-1' });
    const controller = new PaymentManagementController({
      getManagementPayment,
    } as unknown as PaymentService);

    const result = await controller.getOne(userAuth('STAFF'), 'payment-1');

    expect(getManagementPayment).toHaveBeenCalledWith('payment-1', [
      PaymentMethod.CASH,
      PaymentMethod.BANK_TRANSFER,
    ]);
    expect(result.data).toEqual({ id: 'payment-1' });
  });

  it('lets an admin load any payment-detail method', async () => {
    const getManagementPayment = jest
      .fn()
      .mockResolvedValue({ id: 'payment-2' });
    const controller = new PaymentManagementController({
      getManagementPayment,
    } as unknown as PaymentService);

    await controller.getOne(userAuth('ADMIN'), 'payment-2');

    expect(getManagementPayment).toHaveBeenCalledWith('payment-2', undefined);
  });
});

function userAuth(role: 'ADMIN' | 'STAFF'): AccessTokenPayload {
  return {
    sub: `user-${role.toLowerCase()}`,
    actor_type: 'user',
    user_id: `user-${role.toLowerCase()}`,
    role,
    iat: 0,
    exp: 4_102_444_800,
  };
}
