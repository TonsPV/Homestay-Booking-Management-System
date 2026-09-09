// S6/S7/S8: VNPay flows using real backend HMAC verification (sandbox secret
// from .env used locally, never logged).
// S6: normal success (IPN first, then browser return)
// S7: late success after cancellation -> REQUIRES_REVIEW/BOOKING_CANCELLED
// S8: duplicate success -> REQUIRES_REVIEW/ANOTHER_SUCCESSFUL_PAYMENT + resolution
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { api, loginCustomer, loginUser, logScenario } from './helpers.mjs'

// Read VNPAY_HASH_SECRET + TMN from the backend .env (sandbox values).
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
  return { query: `${search.toString()}&vnp_SecureHash=${hash}`, params }
}

function vnPayDate(offsetMinutes = 0) {
  const d = new Date(Date.now() + offsetMinutes * 60_000)
  return d.toISOString().replace(/[-T:]/g, '').slice(0, 14)
}

const admin = await loginUser('admin@example.com', 'admin123')
const adminToken = admin.data.accessToken
const a = await loginCustomer('uat-a@example.com', 'Customer@123')
const tokenA = a.data.accessToken

async function createVnPayPayment(bookingId) {
  const r = await api('POST', `/bookings/${bookingId}/payments`, {
    token: tokenA,
    body: { bankCode: 'VNBANK', locale: 'vn' },
    headers: { 'Idempotency-Key': `uat-s6-pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  })
  return r
}

function extractTxnRef(paymentUrl) {
  return new URL(paymentUrl).searchParams.get('vnp_TxnRef')
}

async function ipnSuccess(paymentUrl, amountVnd) {
  const txnRef = extractTxnRef(paymentUrl)
  const base = {
    vnp_Amount: String(amountVnd * 100),
    vnp_BankCode: 'VNBANK',
    vnp_Command: 'pay',
    vnp_PayDate: vnPayDate(),
    vnp_ResponseCode: '00',
    vnp_TmnCode: TMN,
    vnp_TransactionNo: `UAT${Math.floor(Math.random() * 1e9)}`,
    vnp_TransactionStatus: '00',
    vnp_TxnRef: txnRef,
  }
  const { query } = signCallback(base)
  const res = await fetch(`http://localhost:3000/api/v1/payments/vnpay/ipn?${query}`)
  return { status: res.status, body: await res.json() }
}

async function returnSuccess(paymentUrl, amountVnd) {
  const txnRef = extractTxnRef(paymentUrl)
  const base = {
    vnp_Amount: String(amountVnd * 100),
    vnp_BankCode: 'VNBANK',
    vnp_Command: 'pay',
    vnp_PayDate: vnPayDate(),
    vnp_ResponseCode: '00',
    vnp_TmnCode: TMN,
    vnp_TransactionNo: `UAT${Math.floor(Math.random() * 1e9)}`,
    vnp_TransactionStatus: '00',
    vnp_TxnRef: txnRef,
  }
  const { query } = signCallback(base)
  // VNPAY_FRONTEND_RETURN_URL is configured, so the endpoint answers 302;
  // do not follow the redirect automatically.
  const res = await fetch(`http://localhost:3000/api/v1/payments/vnpay/return?${query}`, { redirect: 'manual' })
  const body = await res.json().catch(() => null)
  return { status: res.status, location: res.headers.get('location'), body }
}

// ============ S6: normal success ============
const s6 = {}

// Customer A used up quota; free 2 pending bookings by cancelling them first.
const myBookings = await api('GET', '/bookings?limit=20&page=1', { token: tokenA })
for (const bk of myBookings.data ?? []) {
  if (bk.status === 'PENDING_PAYMENT') {
    await api('PATCH', `/bookings/${bk.id}/cancel`, {
      token: tokenA,
      body: { reason: 'UAT quota cleanup' },
    })
  }
}

const created6 = await api('POST', '/bookings', {
  token: tokenA,
  body: { roomId: '2', checkInDate: '2027-03-10', checkOutDate: '2027-03-12', guestCount: 2 },
  headers: { 'Idempotency-Key': `uat-s6-book-${Date.now()}` },
})
s6.created = { status: created6.status, bookingId: created6.data?.id, status_: created6.data?.status }
const booking6 = created6.data?.id

const pay6 = await createVnPayPayment(booking6)
s6.paymentCreated = {
  status: pay6.status,
  paymentId: pay6.data?.payment?.id,
  paymentStatus: pay6.data?.payment?.status,
  hasPaymentUrl: Boolean(pay6.data?.paymentUrl),
}
const pay6Id = pay6.data?.payment?.id
const pay6Url = pay6.data?.paymentUrl

// IPN callback (authoritative mutation)
s6.ipn = await ipnSuccess(pay6Url, 3000000)

// Payment history is authoritative
const hist6 = await api('GET', `/bookings/${booking6}/payments`, { token: tokenA })
s6.paymentAfterIpn = (hist6.data ?? []).map((p) => ({
  id: p.id,
  status: p.status,
  gatewayRef: p.gatewayReference,
  txnId: p.gatewayTransactionId,
}))

// Browser return must NOT be the mutation authority (must show same state)
s6.return = await returnSuccess(pay6Url, 3000000)

const detail6 = await api('GET', `/bookings/${booking6}`, { token: tokenA })
s6.bookingAfter = { status: detail6.data?.status, paymentStatus: detail6.data?.paymentStatus }

// Reload of return endpoint gives same state
s6.returnReplay = await returnSuccess(pay6Url, 3000000)

logScenario('S6 result', s6)
