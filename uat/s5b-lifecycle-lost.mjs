// S5b: Full lifecycle CONFIRMED -> CHECKED_IN -> CHECKED_OUT with lost responses.
// Requires paid bookings; uses management manual payment (CASH) to settle, then
// transitions with dropped responses.
import { api, loginUser, logScenario } from './helpers.mjs'

const admin = await loginUser('admin@example.com', 'admin123')
const adminToken = admin.data.accessToken

// Find a customer booking that is PENDING_PAYMENT for a past/today stay, or
// create one via management (management-created bookings for a counter
// customer can be confirmed without online payment rules).
const customers = await api('GET', '/management/customers?limit=10&page=1', { token: adminToken })
const counterCustomer = (customers.data ?? []).find((c) => c.phone)
const out = { counterCustomer: counterCustomer?.id }

const CHECK_IN = '2026-09-03'
const CHECK_OUT = '2026-09-05'

const created = await api('POST', '/management/bookings', {
  token: adminToken,
  body: {
    customerId: counterCustomer?.id,
    roomId: '2',
    checkInDate: CHECK_IN,
    checkOutDate: CHECK_OUT,
    guestCount: 2,
    contactName: 'UAT Counter Guest',
    contactPhone: '0912345678',
  },
  headers: { 'Idempotency-Key': `uat-s5b-create-${Date.now()}` },
})
out.created = { status: created.status, id: created.data?.id, errorCode: created.errorCode, message: created.message?.slice?.(0, 140) }
const bookingId = created.data?.id

async function lostTransition(target) {
  const res = await fetch(`http://localhost:3000/api/v1/management/bookings/${bookingId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ status: target }),
  })
  const status = res.status
  await res.text() // response dropped
  return status
}

const steps = []
for (const target of ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT']) {
  const lost = await lostTransition(target)
  await new Promise((r) => setTimeout(r, 300))

  // FE recovery refetch (authoritative management detail)
  const detail = await api('GET', `/management/bookings/${bookingId}`, { token: adminToken })

  // Stale resend probe
  const resend = await api('PATCH', `/management/bookings/${bookingId}/status`, {
    token: adminToken,
    body: { status: target },
  })

  steps.push({
    target,
    lostTransitionStatus: lost,
    afterRefetch: {
      bookingStatus: detail.data?.status,
      capabilities: (detail.data?.transitionCapabilities ?? []).map((t) => ({
        target: t.targetStatus,
        allowed: t.allowed,
      })),
    },
    resendProbe: {
      httpStatus: resend.status,
      bookingStatusNow: resend.data?.status,
      errorCode: resend.errorCode,
      message: resend.message?.slice?.(0, 110),
    },
  })
}

out.steps = steps
logScenario('S5b result', out)
