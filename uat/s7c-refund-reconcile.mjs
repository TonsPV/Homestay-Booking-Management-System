// S7c: refund replay with SAME key -> PENDING_REPLAY -> reconcile flow.
import { api, loginUser, logScenario } from './helpers.mjs'

const admin = await loginUser('admin@example.com', 'admin123')
const adminToken = admin.data.accessToken
const KEY = 'uat-s7b-refund-1788154568628' // the SAME key from S7b attempt

const out = {}

// Replay with same key: backend treats as PENDING_REPLAY -> reconciles.
const replay = await api('POST', '/management/payments/5/refund', {
  token: adminToken,
  body: { reason: 'UAT S7c replay same key' },
  headers: { 'Idempotency-Key': KEY },
})
out.replay = {
  status: replay.status,
  paymentStatus: replay.data?.status,
  errorCode: replay.errorCode,
  message: replay.message?.slice?.(0, 140) ?? replay.message,
}

// Reconcile explicitly (authoritative query to VNPay sandbox — will fail with
// sandbox network error, which the backend maps to 503).
const reconcile = await api('POST', '/management/payments/5/reconcile-refund', { token: adminToken })
out.reconcile = {
  status: reconcile.status,
  paymentStatus: reconcile.data?.status,
  errorCode: reconcile.errorCode,
  message: reconcile.message?.slice?.(0, 140) ?? reconcile.message,
}

const payments = await api('GET', '/management/payments?limit=20&page=1', { token: adminToken })
out.final = (payments.data ?? []).filter((p) => p.id === '5').map((p) => ({
  id: p.id, status: p.status, refundLastQueriedAt: p.refundLastQueriedAt,
}))

logScenario('S7c result', out)
