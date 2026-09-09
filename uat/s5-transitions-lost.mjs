// S5: Staff transition commits but response is lost (confirm/check-in/check-out).
import { api, loginCustomer, loginUser, logScenario } from './helpers.mjs'

const admin = await loginUser('admin@example.com', 'admin123')
const adminToken = admin.data.accessToken
const a = await loginCustomer('uat-b@example.com', 'Customer@123')
const tokenA = a.data.accessToken // B for S5

// Find a staff account or use admin for management transitions.
const transitions = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT']
const results = []

async function createBooking(checkIn, checkOut, key) {
  const r = await api('POST', '/bookings', {
    token: tokenA,
    body: { roomId: '2', checkInDate: checkIn, checkOutDate: checkOut, guestCount: 2 },
    headers: { 'Idempotency-Key': key },
  })
  return r
}

async function lostTransition(bookingId, target) {
  const res = await fetch(`http://localhost:3000/api/v1/management/bookings/${bookingId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ status: target }),
  })
  const status = res.status
  await res.text() // body dropped -> FE never learns the outcome
  return status
}

const dates = [
  ['2027-01-10', '2027-01-12'],
  ['2027-01-15', '2027-01-17'],
  ['2027-01-20', '2027-01-22'],
]

for (let i = 0; i < transitions.length; i++) {
  const target = transitions[i]
  const [ci, co] = dates[i]

  const created = await createBooking(ci, co, `uat-s5-create-${i}-${Date.now()}`)
  const bookingId = created.data?.id
  if (!bookingId) {
    results.push({ target, created: { status: created.status, errorCode: created.errorCode } })
    continue
  }

  // 1. lost transition to target
  const lostStatus = await lostTransition(bookingId, target)
  await new Promise((r) => setTimeout(r, 300))

  // 2. FE recovery: refetch authoritative detail
  const detail = await api('GET', `/bookings/${bookingId}`, { token: tokenA })

  // 3. Stale UI might resend the same transition: probe.
  const resend = await api('PATCH', `/management/bookings/${bookingId}/status`, {
    token: adminToken,
    body: { status: target },
  })

  // 4. Manual "refresh status": the FE reads transition capabilities.
  const capabilities = (detail.data?.transitionCapabilities ?? []).map((t) => ({
    target: t.targetStatus,
    allowed: t.allowed,
    reason: t.reasonCode,
  }))

  results.push({
    target,
    bookingId,
    lostTransitionStatus: lostStatus,
    afterRefetch: {
      bookingStatus: detail.data?.status,
      capabilities,
    },
    resendProbe: {
      httpStatus: resend.status,
      bookingStatus: resend.data?.status,
      errorCode: resend.errorCode,
      message: resend.message?.slice?.(0, 120) ?? resend.message,
    },
  })
}

logScenario('S5 result', results)
