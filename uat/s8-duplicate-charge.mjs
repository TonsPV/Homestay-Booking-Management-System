// S8: Two successful VNPay payments for one booking (duplicate charge) + resolution.
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

// Free B's quota.
const myBookings = await api('GET', '/bookings?limit=20&page=1', { token: tokenB })
for (const bk of myBookings.data ?? []) {
  if (bk.status === 'PENDING_PAYMENT') {
    await api('PATCH', `/bookings/${bk.id}/cancel`, { token: tokenB, body: { reason: 'UAT quota cleanup' } })
  }
}

// 1. Booking for B.
const created = await api('POST', '/bookings', {
  token: tokenB,
  body: { roomId: '1', checkInDate: '2027-05-10', checkOutDate: '2027-05-12', guestCount: 2 },
  headers: { 'Idempotency-Key': `uat-s8-book-${Date.now()}` },
})
out.created = { status: created.status, bookingId: created.data?.id }
const bookingId = created.data.id

// 2. First VNPay attempt -> IPN success (canonical).
const pay1 = await api('POST', `/bookings/${bookingId}/payments`, {
  token: tokenB,
  body: { bankCode: 'VNBANK', locale: 'vn' },
  headers: { 'Idempotency-Key': `uat-s8-pay1-${Date.now()}` },
})
const url1 = pay1.data?.paymentUrl
const txnRef1 = new URL(url1).searchParams.get('vnp_TxnRef')

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
out.canonicalIpn = { status: ipn1.status, body: await ipn1.json() }

// 3. Second VNPay attempt for the SAME booking (customer retry) -> also success.
const pay2 = await api('POST', `/bookings/${bookingId}/payments`, {
  token: tokenB,
  body: { bankCode: 'VNBANK', locale: 'vn' },
  headers: { 'Idempotency-Key': `uat-s8-pay2-${Date.now()}` },
})
out.secondAttempt = {
  status: pay2.status,
  paymentId: pay2.data?.payment?.id,
  errorCode: pay2.errorCode,
  message: pay2.message?.slice?.(0, 140) ?? pay2.message,
}
const payment2Id = pay2.data?.payment?.id
const url2 = pay2.data?.paymentUrl

// 4. Late success IPN for the second attempt.
const txnRef2 = new URL(url2).searchParams.get('vnp_TxnRef')
const signed2 = signCallback({
  vnp_Amount: '300000000',
  vnp_BankCode: 'VNBANK',
  vnp_Command: 'pay',
  vnp_PayDate: vnPayDate(),
  vnp_ResponseCode: '00',
  vnp_TmnCode: TMN,
  vnp_TransactionNo: `UAT${Math.floor(Math.random() * 1e9)}`,
  vnp_TransactionStatus: '00',
  vnp_TxnRef: txnRef2,
})
const ipn2 = await fetch(`http://localhost:3000/api/v1/payments/vnpay/ipn?${signed2.query}`)
out.duplicateIpn = { status: ipn2.status, body: await ipn2.json() }

// 5. Authoritative payment list for the booking.
const mgmtPayments = await api('GET', `/management/bookings/${bookingId}/payments?limit=10&page=1`, { token: adminToken })
out.payments = (mgmtPayments.data ?? []).map((p) => ({
  id: p.id,
  status: p.status,
  reviewReason: p.reviewReason,
  canonical: p.reviewCanonicalPaymentId,
  amount: p.amount,
  method: p.method,
}))

// 6. Duplicate-charge resolution on the flagged payment.
if (payment2Id) {
  const KEY = `uat-s8-resolve-${payment2Id}-${Date.now()}`
  const resolve1 = await api('POST', `/management/payments/${payment2Id}/resolve-duplicate-charge`, {
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

  // Double submission guard: replay the SAME logical attempt (same key).
  const resolve2 = await api('POST', `/management/payments/${payment2Id}/resolve-duplicate-charge`, {
    token: adminToken,
    headers: { 'Idempotency-Key': KEY },
  })
  out.resolveReplay = {
    status: resolve2.status,
    paymentStatus: resolve2.data?.status,
    errorCode: resolve2.errorCode,
    message: resolve2.message?.slice?.(0, 140) ?? resolve2.message,
  }

  // Wrong-endpoint probe: generic refund on an already-REFUNDED duplicate.
  const wrongEndpoint = await api('POST', `/management/payments/${payment2Id}/refund`, {
    token: adminToken,
    body: { reason: 'UAT S8 wrong-endpoint probe' },
    headers: { 'Idempotency-Key': `uat-s8-wrong-${Date.now()}` },
  })
  out.wrongEndpointProbe = {
    status: wrongEndpoint.status,
    paymentStatus: wrongEndpoint.data?.status,
    errorCode: wrongEndpoint.errorCode,
    message: wrongEndpoint.message?.slice?.(0, 140) ?? wrongEndpoint.message,
  }
}

// 7. Final authoritative state.
const finalPayments = await api('GET', `/management/bookings/${bookingId}/payments?limit=10&page=1`, { token: adminToken })
out.finalPayments = (finalPayments.data ?? []).map((p) => ({
  id: p.id,
  status: p.status,
  reviewReason: p.reviewReason,
  canonical: p.reviewCanonicalPaymentId,
  refundedAt: p.refundedAt,
}))

const detail = await api('GET', `/management/bookings/${bookingId}`, { token: adminToken })
out.finalBooking = { status: detail.data?.status, paymentStatus: detail.data?.paymentStatus }

logScenario('S8 result', out)
