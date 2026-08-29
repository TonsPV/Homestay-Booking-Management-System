/**
 * Format shared by payment idempotency keys and booking request-intent keys.
 * Trimming and required/optional handling remain owned by each caller.
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/;

export function isValidIdempotencyKey(value: string): boolean {
  return IDEMPOTENCY_KEY_PATTERN.test(value);
}
