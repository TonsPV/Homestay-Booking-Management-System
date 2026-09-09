// S7b: Standard refund on the BOOKING_CANCELLED review payment (allowed by BE).
import { api, loginUser, logScenario } from './helpers.mjs'

const admin = await loginUser('admin@example.com', 'admin123')
const adminToken = admin.data.accessToken

const out = {}

// Payment 5 from S7 is REQUIRES_REVIEW / BOOKING_CANCELLED / VNPAY.
// Standard refund endpoint requires an Idempotency-Key for VNPay.
const refund = await api('POST', '/management/payments/5/refund', {
  token: adminToken,
  body: { reason: 'UAT S7b — late payment refund after cancellation' },
  headers: { 'Idempotency-Key': `uat-s7b-refund-${Date.now()}` },
})
out.refund = {
  status: refund.status,
  paymentStatus: refund.data?.status,
  refundPreviousStatus: refund.data?.refundPreviousStatus,
  refundResponseCode: refund.data?.refundResponseCode,
  refundTransactionStatus: refund.data?.refundTransactionStatus,
  refundedAt: refund.data?.refundedAt,
  errorCode: refund.errorCode,
  message: refund.message?.slice?.(0, 140) ?? refund.message,
}

const detail = await api('GET', '/management/payments/5', { token: adminToken }).catch(() => null)
const payments = await api('GET', '/management/payments?limit=20&page=1', { token: adminToken })
out.final = (payments.data ?? [])
  .filter((p) => p.id === '5')
  .map((p) => ({ id: p.id, status: p.status, refundedAt: p.refundedAt, refundedBy: p.refundedByUser?.fullName }))

logScenario('S7b result', out)
