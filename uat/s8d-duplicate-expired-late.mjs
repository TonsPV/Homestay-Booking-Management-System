// S8d: duplicate charge via EXPIRED first attempt + late IPN, then retry.
// pay1 -> (expires at provider side) pay2 created (pay1 expired->FAILED) ->
// pay2 IPN success (canonical) -> pay1 late IPN success -> REQUIRES_REVIEW.
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

// 1. Booking for B on room 1.
const created = await api('POST', '/bookings', {
  token: tokenB,
  body: { roomId: '1', checkInDate: '2027-08-10', checkOutDate: '2027-08-12', guestCount: 2 },
  headers: { 'Idempotency-Key': `uat-s8d-book-${Date.now()}` },
})
out.created = { status: created.status, bookingId: created.data?.id }
const bookingId = created.data.id

// 2. First VNPay attempt (pay1).
const pay1 = await api('POST', `/bookings/${bookingId}/payments`, {
  token: tokenB,
  body: { bankCode: 'VNBANK', locale: 'vn' },
  headers: { 'Idempotency-Key': `uat-s8d-pay1-${Date.now()}` },
})
out.pay1 = { status: pay1.status, paymentId: pay1.data?.payment?.id }
const payment1Id = pay1.data?.payment?.id
const url1 = pay1.data?.paymentUrl
const txnRef1 = new URL(url1).searchParams.get('vnp_TxnRef')

// 3. Simulate the attempt expiring: backend treats EXPIRED past-attempts as
//    FAILED when a new attempt arrives. Mark pay1's expires_at in the past so
//    the next create expires it (the same effect as the 15-min window passing).
const expireSql = `UPDATE payments SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = ${payment1Id};`
out.expiredPay1 = 'expires_at set to past (simulating the 15-min attempt window)'

// 3b. Expire pay1 via DB (simulating the 15-min window passing).
{
  const { spawnSync } = await import('node:child_process');
  spawnSync(
    'C:/Program Files/MySQL/MySQL Server 9.4/bin/mysql.exe',
    [
      '-h127.0.0.1', '-uroot', '-p742005', 'hbms',
      '-e',
      `UPDATE payments SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = ${payment1Id} AND status = 'PENDING'`,
    ],
    { stdio: 'ignore' },
  );
}

// 4. Customer retries: pay1 is expired-PENDING -> expired to FAILED/EXPIRED,
//    pay2 created PENDING.
const pay2 = await api('POST', `/bookings/${bookingId}/payments`, {
  token: tokenB,
  body: { bankCode: 'VNBANK', locale: 'vn' },
  headers: { 'Idempotency-Key': `uat-s8d-pay2-${Date.now()}` },
})
out.pay2 = {
  status: pay2.status,
  paymentId: pay2.data?.payment?.id,
  paymentStatus: pay2.data?.payment?.status,
  errorCode: pay2.errorCode,
  message: pay2.message?.slice?.(0, 140) ?? pay2.message,
}
const payment2Id = pay2.data?.payment?.id
const url2 = pay2.data?.paymentUrl
const txnRef2 = new URL(url2).searchParams.get('vnp_TxnRef')

// 5. Retry succeeds -> canonical.
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
out.canonicalIpn = { status: ipn2.status, body: await ipn2.json() }

// 6. The FIRST attempt's success arrives late at the provider (race): IPN for pay1.
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
out.lateIpnForExpired = { status: ipn1.status, body: await ipn1.json() }

// 7. Authoritative payment state.
const mgmtPayments = await api('GET', `/management/bookings/${bookingId}/payments?limit=10&page=1`, { token: adminToken })
out.payments = (mgmtPayments.data ?? []).map((p) => ({
  id: p.id,
  method: p.method,
  status: p.status,
  reviewReason: p.reviewReason,
  canonical: p.reviewCanonicalPaymentId,
  gatewayRef: p.gatewayReference,
  gatewayResponseCode: p.gatewayResponseCode,
}))

// 8. Duplicate-charge resolution on the flagged payment.
const duplicate = (mgmtPayments.data ?? []).find(
  (p) => p.status === 'REQUIRES_REVIEW' && p.reviewReason === 'ANOTHER_SUCCESSFUL_PAYMENT',
)
if (duplicate) {
  const KEY = `uat-s8d-resolve-${duplicate.id}-${Date.now()}`
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
    body: { reason: 'UAT S8d wrong-endpoint probe' },
    headers: { 'Idempotency-Key': `uat-s8d-wrong-${Date.now()}` },
  })
  out.wrongEndpointProbe = {
    status: wrongEndpoint.status,
    paymentStatus: wrongEndpoint.data?.status,
    errorCode: wrongEndpoint.errorCode,
    message: wrongEndpoint.message?.slice?.(0, 140) ?? wrongEndpoint.message,
  }
} else {
  out.resolve = 'SKIPPED — no ANOTHER_SUCCESSFUL_PAYMENT flag'
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

logScenario('S8d result', out)
