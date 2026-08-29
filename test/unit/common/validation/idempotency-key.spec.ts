import {
  IDEMPOTENCY_KEY_PATTERN,
  isValidIdempotencyKey,
} from '../../../../src/common/validation/idempotency-key';

describe('idempotency key format', () => {
  it.each(['a1234567', 'payment-key-01', 'A'.repeat(100)])(
    'accepts %s',
    (value) => {
      expect(isValidIdempotencyKey(value)).toBe(true);
      expect(IDEMPOTENCY_KEY_PATTERN.test(value)).toBe(true);
    },
  );

  it.each([
    'short-1',
    '-payment-key',
    'payment/key-1',
    ' payment-key-1',
    'A'.repeat(101),
  ])('rejects %s', (value) => {
    expect(isValidIdempotencyKey(value)).toBe(false);
  });
});
