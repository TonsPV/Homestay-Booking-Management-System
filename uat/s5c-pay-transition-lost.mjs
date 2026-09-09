// S5c: pay a counter booking with CASH, then lost-response CHECKED_IN/CHECKED_OUT.
import { api, loginUser, logScenario } from './helpers.mjs'

const admin = await loginUser('admin@example.com', 'admin123')
const adminToken = admin.data.accessToken
const bookingId = process.argv[2] ?? '22'

// 1. Record CASH payment (Idempotency-Key required).
const payment = await api('POST', `/management/bookings/${bookingId}/payments`, {
  token: adminToken,
  body: { method: 'CASH' },
  headers: { 'Idempotency-Key': `uat-s5c-pay-${Date.now()}` },
})
const out = {
  payment: {
    status: payment.status,
    paymentId: payment.data?.id,
    paymentStatus: payment.data?.status,
    bookingStatus: payment.data?.bookingStatus,
    errorCode: payment.errorCode,
    message: payment.message?.slice?.(0, 140),
  },
  steps: [],
}

for (const target of ['CHECKED_IN', 'CHECKED_OUT']) {
  // lost transition
  const res = await fetch(`http://localhost:3000/api/v1/management/bookings/${bookingId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ status: target }),
  })
  const lostStatus = res.status
  await res.text()
  await new Promise((r) => setTimeout(r, 300))

  // recovery refetch
  const detail = await api('GET', `/management/bookings/${bookingId}`, { token: adminToken })

  // stale resend probe
  const resend = await api('PATCH', `/management/bookings/${bookingId}/status`, {
    token: adminToken,
    body: { status: target },
  })

  out.steps.push({
    target,
    lostTransitionStatus: lostStatus,
    afterRefetch: {
      bookingStatus: detail.data?.status,
      capabilities: (detail.data?.transitionCapabilities ?? [])
        .filter((t) => t.allowed)
        .map((t) => t.targetStatus),
    },
    resendProbe: {
      httpStatus: resend.status,
      bookingStatusNow: resend.data?.status,
      errorCode: resend.errorCode,
      message: resend.message?.slice?.(0, 110),
    },
  })
}

// Authoritative DB-adjacent state via API
const finalDetail = await api('GET', `/management/bookings/${bookingId}`, { token: adminToken })
out.final = {
  status: finalDetail.data?.status,
  paymentStatus: finalDetail.data?.paymentStatus,
  checkedInAt: finalDetail.data?.checkedInAt ?? null,
  checkedOutAt: finalDetail.data?.checkedOutAt ?? null,
}

logScenario('S5c result', out)
