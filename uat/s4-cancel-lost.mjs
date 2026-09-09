// S4: Cancel booking commits but FE loses response.
import { api, loginCustomer, logScenario } from './helpers.mjs'

const a = await loginCustomer('uat-a@example.com', 'Customer@123')
const tokenA = a.data.accessToken

// A's oldest pending booking (from S1): id 1.
const detailBefore = await api('GET', '/bookings/1', { token: tokenA })
logScenario('S4 precondition', {
  bookingId: detailBefore.data?.id,
  status: detailBefore.data?.status,
  cancelCapability: detailBefore.data?.transitionCapabilities?.find(
    (t) => t.targetStatus === 'CANCELLED',
  ),
})

// Cancel with response lost: send request, abort before reading body.
const cancelController = new AbortController()
let lostOutcome
try {
  const res = await fetch('http://localhost:3000/api/v1/bookings/1/cancel', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`,
      'Idempotency-Key': `uat-s4-cancel-${Date.now()}`,
    },
    body: JSON.stringify({ reason: 'UAT lost-response test' }),
    signal: cancelController.signal,
  })
  await res.text()
  lostOutcome = { status: res.status, bodyReadButDropped: true }
} catch (error) {
  lostOutcome = { aborted: true, errorName: error.name }
}
await new Promise((r) => setTimeout(r, 400))

// FE recovery: refetch authoritative booking detail.
const detailAfter = await api('GET', '/bookings/1', { token: tokenA })

// A second cancel attempt must not be sent by a correct FE; if it is, the
// backend must reject it as a non-cancellable state.
const secondCancel = await api('PATCH', '/bookings/1/cancel', {
  token: tokenA,
  body: { reason: 'duplicate cancel probe' },
})

logScenario('S4 result', {
  lostOutcome,
  afterRefetch: {
    status: detailAfter.status,
    bookingStatus: detailAfter.data?.status,
    cancelledAt: detailAfter.data?.cancelledAt,
    cancelStillOffered: detailAfter.data?.transitionCapabilities?.some(
      (t) => t.targetStatus === 'CANCELLED' && t.allowed,
    ),
  },
  secondCancelProbe: {
    httpStatus: secondCancel.status,
    errorCode: secondCancel.errorCode,
    message: secondCancel.message?.slice?.(0, 120) ?? secondCancel.message,
  },
})
