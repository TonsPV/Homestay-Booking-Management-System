// S4b: Cancel booking commits but FE loses response (fresh booking).
import { api, loginCustomer, logScenario } from './helpers.mjs'

const CHECK_IN = '2026-12-10'
const CHECK_OUT = '2026-12-12'
const KEY = `uat-s4b-create-${Date.now()}`

const a = await loginCustomer('uat-a@example.com', 'Customer@123')
const tokenA = a.data.accessToken

// Create a fresh booking (room 2 is free on these dates).
const created = await api('POST', '/bookings', {
  token: tokenA,
  body: {
    roomId: '2',
    checkInDate: CHECK_IN,
    checkOutDate: CHECK_OUT,
    guestCount: 2,
  },
  headers: { 'Idempotency-Key': KEY },
})
const bookingId = created.data?.id
logScenario('S4b precondition', {
  createdStatus: created.status,
  bookingId,
  bookingStatus: created.data?.status,
})

// Cancel with response lost (PATCH /bookings/:id/cancel, abort before body).
const res = await fetch(`http://localhost:3000/api/v1/bookings/${bookingId}/cancel`, {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${tokenA}`,
  },
  body: JSON.stringify({ reason: 'UAT S4 lost-response' }),
})
const commitStatus = res.status
const commitBody = await res.text() // read+drop: client "knows nothing"
await new Promise((r) => setTimeout(r, 300))

// FE recovery: refetch authoritative booking detail.
const detailAfter = await api('GET', `/bookings/${bookingId}`, { token: tokenA })

// A stale FE might re-send cancel; the backend must reject idempotently.
const secondCancel = await api('PATCH', `/bookings/${bookingId}/cancel`, {
  token: tokenA,
  body: { reason: 'duplicate cancel probe' },
})

logScenario('S4b result', {
  cancelRequest: { commitStatus, bodyLen: commitBody.length },
  afterRefetch: {
    bookingStatus: detailAfter.data?.status,
    cancelledAt: detailAfter.data?.cancelledAt,
    cancellationReason: detailAfter.data?.cancellationReason,
    cancelStillOffered: detailAfter.data?.transitionCapabilities?.some(
      (t) => t.targetStatus === 'CANCELLED' && t.allowed,
    ),
  },
  secondCancelProbe: {
    httpStatus: secondCancel.status,
    errorCode: secondCancel.errorCode,
    message: secondCancel.message?.slice?.(0, 140) ?? secondCancel.message,
  },
})
