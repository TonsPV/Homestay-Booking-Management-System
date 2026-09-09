// S8c: duplicate charge via management CASH payment accepted FIRST, then a
// late VNPay IPN success for a PENDING VNPay attempt -> ANOTHER_SUCCESSFUL_PAYMENT.
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { api, loginCustomer, loginUser, logScenario } from './helpers.mjs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const SECRET = env.VNPAY_HASH_SECRET
const TMN = env.VNPAY_TMN_CODE

function signCallback(params) {
  const sorted = Object.keys(params).sort()
  const search = new URLSearchParams()
  for (const key of sorted) {
    if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
      search.append(key, String(params[key]))
    }
  }
  const hash = createHmac('sha512', SECRET).update(search.toString(), 'utf8').digest('hex')
  return { query: `${search.toString()}&vnp_SecureHash=${hash}` }
}

function vnPayDate() {
  return new Date().toISOString().replace(/[-T:]/g, '').slice(0, 14)
}

const admin = await loginUser('admin@example.com', 'admin123')
const adminToken = admin.data.accessToken
const b = await loginCustomer('uat-b@example.com', 'Customer@123')
const tokenB = b.data.accessToken

const out = {}

// Free quota.
const myBookings = await api('GET', '/bookings?limit=20&page=1', { token: tokenB })
for (const bk of myBookings.data ?? []) {
  if (bk.status === 'PENDING_PAYMENT') {
    await api('PATCH', `/bookings/${bk.id}/cancel`, { token: tokenB, body: { reason: 'UAT quota cleanup' } })
  }
}

// 1. Customer booking on room 1.
const created = await api('POST', '/bookings', {
  token: tokenB,
  body: { roomId: '1', checkInDate: '2027-07-10', checkOutDate: '2027-07-12', guestCount: 2 },
  headers: { 'Idempotency-Key': `uat-s8c-book-${Date.now()}` },
})
out.created = { status: created.status, bookingId: created.data?.id }
const bookingId = created.data.id

// 2. Customer opens VNPay checkout (attempt 1, stays PENDING).
const pay1 = await api('POST', `/bookings/${bookingId}/payments`, {
  token: tokenB,
  body: { bankCode: 'VNBANK', locale: 'vn' },
  headers: { 'Idempotency-Key': `uat-s8c-pay1-${Date.now()}` },
})
out.pay1 = { status: pay1.status, paymentId: pay1.data?.payment?.id }
const payment1Id = pay1.data?.payment?.id

// 3. Meanwhile the customer pays at the counter; staff records CASH ->
//    booking becomes CONFIRMED/PAID with acceptedPaymentId = cash payment.
const cash = await api('POST', `/management/bookings/${bookingId}/payments`, {
  token: adminToken,
  body: { method: 'CASH' },
  headers: { 'Idempotency-Key': `uat-s8c-cash-${Date.now()}` },
})
out.cash = {
  status: cash.status,
  paymentId: cash.data?.id,
  paymentStatus: cash.data?.status,
  errorCode: cash.errorCode,
  message: cash.message?.slice?.(0, 140) ?? cash.message,
}

// 4. The abandoned VNPay attempt ALSO succeeds at the provider (late IPN).
const pay1Detail = await api('GET', `/management/bookings/${bookingId}/payments?limit=10&page=1`, { token: adminToken })
const vnpayPayment = (pay1Detail.data ?? []).find((p) => p.id === payment1Id)
out.vnpayBefore = { status: vnpayPayment?.status, gatewayRef: vnpayPayment?.gatewayReference }

const payUrl = (await api('GET', `/management/bookings/${bookingId}`, { token: adminToken })) // placeholder
// Reconstruct the payment URL txnRef from the stored gateway reference (P<id>).
const txnRef1 = `P${payment1Id}`
const signed1 = signCallback({
  vnp_Amount: '300000000',
  vnp_BankCode: 'VNBANK',
  vnp_Command: 'pay',
  vnp_PayDate: vnPayDate(),
  vnp_ResponseCode: '00',
  vnp_TmnCode: TMN,
  vnp_TransactionNo: `UAT${Math.floor(Math.random() * 1e9)}`,
  vnp_TransactionStatus: '00',
  vnp_TxnRef: txnRef1,
})
const ipn1 = await fetch(`http://localhost:3000/api/v1/payments/vnpay/ipn?${signed1.query}`)
out.duplicateIpn = { status: ipn1.status, body: await ipn1.json() }

// 5. Authoritative payment state.
const mgmtPayments = await api('GET', `/management/bookings/${bookingId}/payments?limit=10&page=1`, { token: adminToken })
out.payments = (mgmtPayments.data ?? []).map((p) => ({
  id: p.id,
  method: p.method,
  status: p.status,
  reviewReason: p.reviewReason,
  canonical: p.reviewCanonicalPaymentId,
  gatewayRef: p.gatewayReference,
}))

// 6. Duplicate-charge resolution on the flagged VNPay payment.
const duplicate = (mgmtPayments.data ?? []).find(
  (p) => p.status === 'REQUIRES_REVIEW' && p.reviewReason === 'ANOTHER_SUCCESSFUL_PAYMENT',
)
if (duplicate) {
  const KEY = `uat-s8c-resolve-${duplicate.id}-${Date.now()}`
  const resolve1 = await api('POST', `/management/payments/${duplicate.id}/resolve-duplicate-charge`, {
    token: adminToken,
    headers: { 'Idempotency-Key': KEY },
  })
  out.resolve = {
    status: resolve1.status,
    paymentStatus: resolve1.data?.status,
    refundPreviousStatus: resolve1.data?.refundPreviousStatus,
    errorCode: resolve1.errorCode,
    message: resolve1.message?.slice?.(0, 140) ?? resolve1.message,
  }

  const resolve2 = await api('POST', `/management/payments/${duplicate.id}/resolve-duplicate-charge`, {
    token: adminToken,
    headers: { 'Idempotency-Key': KEY },
  })
  out.resolveReplay = {
    status: resolve2.status,
    paymentStatus: resolve2.data?.status,
    errorCode: resolve2.errorCode,
    message: resolve2.message?.slice?.(0, 140) ?? resolve2.message,
  }

  const wrongEndpoint = await api('POST', `/management/payments/${duplicate.id}/refund`, {
    token: adminToken,
    body: { reason: 'UAT S8c wrong-endpoint probe' },
    headers: { 'Idempotency-Key': `uat-s8c-wrong-${Date.now()}` },
  })
  out.wrongEndpointProbe = {
    status: wrongEndpoint.status,
    paymentStatus: wrongEndpoint.data?.status,
    errorCode: wrongEndpoint.errorCode,
    message: wrongEndpoint.message?.slice?.(0, 140) ?? wrongEndpoint.message,
  }
} else {
  out.resolve = 'SKIPPED — no ANOTHER_SUCCESSFUL_PAYMENT flag; duplicate not reproduced'
}

const finalPayments = await api('GET', `/management/bookings/${bookingId}/payments?limit=10&page=1`, { token: adminToken })
out.finalPayments = (finalPayments.data ?? []).map((p) => ({
  id: p.id,
  method: p.method,
  status: p.status,
  reviewReason: p.reviewReason,
  canonical: p.reviewCanonicalPaymentId,
  refundedAt: p.refundedAt,
}))

const detail = await api('GET', `/management/bookings/${bookingId}`, { token: adminToken })
out.finalBooking = { status: detail.data?.status, paymentStatus: detail.data?.paymentStatus }

logScenario('S8c result', out)
