// S7: VNPay success AFTER booking cancellation -> REQUIRES_REVIEW/BOOKING_CANCELLED.
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
  return { query: `${search.toString()}&vnp_SecureHash=${hash}`, search: search.toString() }
}

function vnPayDate() {
  return new Date().toISOString().replace(/[-T:]/g, '').slice(0, 14)
}

const admin = await loginUser('admin@example.com', 'admin123')
const adminToken = admin.data.accessToken
const a = await loginCustomer('uat-a@example.com', 'Customer@123')
const tokenA = a.data.accessToken

const out = {}

// Free quota: cancel A's pending bookings.
const myBookings = await api('GET', '/bookings?limit=20&page=1', { token: tokenA })
for (const bk of myBookings.data ?? []) {
  if (bk.status === 'PENDING_PAYMENT') {
    await api('PATCH', `/bookings/${bk.id}/cancel`, { token: tokenA, body: { reason: 'UAT quota cleanup' } })
  }
}

// 1. Create booking + VNPay payment attempt.
const created = await api('POST', '/bookings', {
  token: tokenA,
  body: { roomId: '2', checkInDate: '2027-04-10', checkOutDate: '2027-04-12', guestCount: 2 },
  headers: { 'Idempotency-Key': `uat-s7-book-${Date.now()}` },
})
out.created = { status: created.status, bookingId: created.data?.id }
const bookingId = created.data.id

const pay = await api('POST', `/bookings/${bookingId}/payments`, {
  token: tokenA,
  body: { bankCode: 'VNBANK', locale: 'vn' },
  headers: { 'Idempotency-Key': `uat-s7-pay-${Date.now()}` },
})
const paymentUrl = pay.data?.paymentUrl
out.paymentCreated = { status: pay.status, paymentId: pay.data?.payment?.id, status_: pay.data?.payment?.status }
const paymentId = pay.data?.payment?.id

// 2. Customer cancels the booking while payment is still PENDING.
const cancel = await api('PATCH', `/bookings/${bookingId}/cancel`, {
  token: tokenA,
  body: { reason: 'UAT S7 — changed plans before paying' },
})
out.cancel = { status: cancel.status, bookingStatus: cancel.data?.status }

// 3. The provider later reports SUCCESS (late IPN).
const txnRef = new URL(paymentUrl).searchParams.get('vnp_TxnRef')
const base = {
  vnp_Amount: '300000000',
  vnp_BankCode: 'VNBANK',
  vnp_Command: 'pay',
  vnp_PayDate: vnPayDate(),
  vnp_ResponseCode: '00',
  vnp_TmnCode: TMN,
  vnp_TransactionNo: `UAT${Math.floor(Math.random() * 1e9)}`,
  vnp_TransactionStatus: '00',
  vnp_TxnRef: txnRef,
}
const signed = signCallback(base)
const ipnRes = await fetch(`http://localhost:3000/api/v1/payments/vnpay/ipn?${signed.query}`)
out.lateIpn = { status: ipnRes.status, body: await ipnRes.json() }

// 4. Authoritative payment state.
const mgmtPayments = await api('GET', `/management/bookings/${bookingId}/payments?limit=10&page=1`, { token: adminToken })
out.paymentAfterLateIpn = (mgmtPayments.data ?? []).map((p) => ({
  id: p.id,
  status: p.status,
  reviewReason: p.reviewReason,
  reviewCanonicalPaymentId: p.reviewCanonicalPaymentId,
  amount: p.amount,
  method: p.method,
  gatewayRef: p.gatewayReference,
  txn: p.gatewayTransactionId,
}))

const detail = await api('GET', `/management/bookings/${bookingId}`, { token: adminToken })
out.bookingAfter = { status: detail.data?.status, paymentStatus: detail.data?.paymentStatus }

out.expectation = {
  paymentStatus: 'REQUIRES_REVIEW',
  reviewReason: 'BOOKING_CANCELLED',
  bookingStatus: 'CANCELLED',
}

logScenario('S7 result', out)
