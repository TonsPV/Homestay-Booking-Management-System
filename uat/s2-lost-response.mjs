// S2: Booking commits but FE loses response; retry with same Idempotency-Key replays.
import { api, loginCustomer, logScenario } from './helpers.mjs'

const CHECK_IN = '2026-11-05'
const CHECK_OUT = '2026-11-07'
const KEY = `uat-s2-${Date.now()}`

const a = await loginCustomer('uat-a@example.com', 'Customer@123')
const tokenA = a.data.accessToken

const payload = {
  roomId: '2',
  checkInDate: CHECK_IN,
  checkOutDate: CHECK_OUT,
  guestCount: 2,
}

// Attempt 1: request goes out; we simulate "response lost" by aborting the
// fetch after the server has processed it. AbortController + small delay.
const controller = new AbortController()
let firstOutcome
try {
  const res = await fetch('http://localhost:3000/api/v1/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`,
      'Idempotency-Key': KEY,
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
  // Read status then "drop" the body like a transport failure.
  firstOutcome = { status: res.status, bodyDropped: true }
  await res.text()
} catch (error) {
  firstOutcome = { aborted: true, errorName: error.name }
}

// Give the backend a moment to finish committing.
await new Promise((r) => setTimeout(r, 500))

// Attempt 2: retry with the SAME Idempotency-Key (the FE recovery path).
const retry = await api('POST', '/bookings', {
  token: tokenA,
  body: payload,
  headers: { 'Idempotency-Key': KEY },
})

// Attempt 3: retry once more to prove idempotent replay stability.
const retry2 = await api('POST', '/bookings', {
  token: tokenA,
  body: payload,
  headers: { 'Idempotency-Key': KEY },
})

// Attempt 4: SAME payload but NO key -> this models a client that lost its
// intent key; the backend should NOT create a second booking for the same
// room/dates (inventory conflict), proving inventory-level protection.
const noKey = await api('POST', '/bookings', { token: tokenA, body: payload })

logScenario('S2 result', {
  firstOutcome,
  retry: {
    httpStatus: retry.status,
    bookingId: retry.data?.id,
    bookingStatus: retry.data?.status,
    errorCode: retry.errorCode,
  },
  retry2: {
    status: retry2.status,
    bookingId: retry2.data?.id,
    sameBookingId: retry.data?.id === retry2.data?.id,
  },
  noKeyRetry: {
    status: noKey.status,
    bookingId: noKey.data?.id,
    errorCode: noKey.errorCode,
    message: noKey.message?.slice?.(0, 120) ?? noKey.message,
  },
})
