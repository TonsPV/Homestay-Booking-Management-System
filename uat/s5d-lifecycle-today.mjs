// S5d: Lost-response transitions on a booking whose stay window includes today.
// Creates a management booking for check-in today, pays CASH, then
// CONFIRMED? -> CHECKED_IN -> CHECKED_OUT with dropped responses.
import { api, loginUser, logScenario } from './helpers.mjs'

const admin = await loginUser('admin@example.com', 'admin123')
const adminToken = admin.data.accessToken

function vnDate(offsetDays = 0) {
  const now = new Date(Date.now() + 7 * 3600 * 1000 + offsetDays * 86400 * 1000)
  return now.toISOString().slice(0, 10)
}

const CHECK_IN = vnDate(0) // today
const CHECK_OUT = vnDate(2)
const out = { window: { CHECK_IN, CHECK_OUT }, steps: [] }

const customers = await api('GET', '/management/customers?limit=10&page=1', { token: adminToken })
const counterCustomer = (customers.data ?? []).find((c) => c.phone)

const created = await api('POST', '/management/bookings', {
  token: adminToken,
  body: {
    customerId: counterCustomer?.id,
    roomId: '2',
    checkInDate: CHECK_IN,
    checkOutDate: CHECK_OUT,
    guestCount: 2,
    contactName: 'UAT Lifecycle Guest',
    contactPhone: '0912345678',
  },
  headers: { 'Idempotency-Key': `uat-s5d-create-${Date.now()}` },
})
out.created = { status: created.status, id: created.data?.id, errorCode: created.errorCode }
const bookingId = created.data?.id
if (!bookingId) {
  logScenario('S5d aborted', out)
  process.exit(1)
}

// Pay CASH -> booking becomes PAID (and typically CONFIRMED)
const payment = await api('POST', `/management/bookings/${bookingId}/payments`, {
  token: adminToken,
  body: { method: 'CASH' },
  headers: { 'Idempotency-Key': `uat-s5d-pay-${Date.now()}` },
})
out.payment = { status: payment.status, paymentStatus: payment.data?.status, bookingAfterPay: payment.data?.bookingStatus ?? payment.data?.status }

// Make sure booking is CONFIRMED (allowed transition) before check-in.
const pre = await api('GET', `/management/bookings/${bookingId}`, { token: adminToken })
if (pre.data?.status !== 'CONFIRMED') {
  const toConfirmed = await api('PATCH', `/management/bookings/${bookingId}/status`, {
    token: adminToken,
    body: { status: 'CONFIRMED' },
  })
  out.confirmedNow = { status: toConfirmed.status, errorCode: toConfirmed.errorCode }
}

for (const target of ['CHECKED_IN', 'CHECKED_OUT']) {
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

  const detail = await api('GET', `/management/bookings/${bookingId}`, { token: adminToken })
  const resend = await api('PATCH', `/management/bookings/${bookingId}/status`, {
    token: adminToken,
    body: { status: target },
  })

  out.steps.push({
    target,
    lostTransitionStatus: lostStatus,
    afterRefetch: {
      bookingStatus: detail.data?.status,
      allowedTargets: (detail.data?.transitionCapabilities ?? [])
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

const finalDetail = await api('GET', `/management/bookings/${bookingId}`, { token: adminToken })
out.final = {
  status: finalDetail.data?.status,
  paymentStatus: finalDetail.data?.paymentStatus,
  checkedInAt: finalDetail.data?.checkedInAt ?? null,
  checkedOutAt: finalDetail.data?.checkedOutAt ?? null,
}

logScenario('S5d result', out)
