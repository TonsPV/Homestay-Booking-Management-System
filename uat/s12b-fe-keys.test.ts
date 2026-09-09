// S12: FE-side idempotency behavior (run under FE vitest).
import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearDuplicateResolutionKey,
  getOrCreateDuplicateResolutionKey,
  getOrCreateRefundPaymentKey,
  getOrCreateVnPayAttempt,
  clearVnPayAttempt,
  getOrCreateManualPaymentKey,
} from './idempotency'

beforeEach(() => localStorage.clear())

describe('S12: FE idempotency keys (multi-tab / refresh / actor-switch)', () => {
  it('keeps the same logical attempt key across simulated page refreshes', () => {
    const k1 = getOrCreateDuplicateResolutionKey('95')
    // Simulate refresh: storage persists, module re-imports in real life.
    const k2 = getOrCreateDuplicateResolutionKey('95')
    expect(k2).toBe(k1)
  })

  it('scopes VNPay attempt per booking, not globally', () => {
    const a = getOrCreateVnPayAttempt('901')
    const b = getOrCreateVnPayAttempt('902')
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey)
    clearVnPayAttempt('901')
    clearVnPayAttempt('902')
  })

  it('manual payment keys are scoped per booking+method', () => {
    const cash = getOrCreateManualPaymentKey('901', 'CASH')
    const bank = getOrCreateManualPaymentKey('901', 'BANK_TRANSFER')
    expect(cash).not.toBe(bank)
  })

  it('duplicate-resolution and refund keys never collide', () => {
    const dup = getOrCreateDuplicateResolutionKey('95')
    const refund = getOrCreateRefundPaymentKey('95')
    expect(dup).not.toBe(refund)
    clearDuplicateResolutionKey('95')
  })

  it('clearing one payment key does not clear another payment key', () => {
    const a = getOrCreateDuplicateResolutionKey('95')
    const b = getOrCreateDuplicateResolutionKey('96')
    clearDuplicateResolutionKey('95')
    expect(getOrCreateDuplicateResolutionKey('96')).toBe(b)
    expect(a).not.toBe(b)
  })
})
