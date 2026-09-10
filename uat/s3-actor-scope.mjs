// S3: Customer A -> logout -> Customer B -> Customer A (actor-scoped intent).
import { api, loginCustomer, logScenario } from './helpers.mjs'

const CHECK_IN = '2026-12-05'
const CHECK_OUT = '2026-12-07'

// fresh keys isolated per customer via the FE storage prefix; here we model
// the FE behavior: A starts with key KA, B uses its own KB, A resumes KA.
const KA = `uat-s3-a-${Date.now()}`
const KB = `uat-s3-b-${Date.now()}`

const a = await loginCustomer('uat-a@example.com', 'Customer@123')
const b = await loginCustomer('uat-b@example.com', 'Customer@123')
const tokenA = a.data.accessToken
const tokenB = b.data.accessToken

const payload = {
  roomId: '2',
  checkInDate: CHECK_IN,
  checkOutDate: CHECK_OUT,
  guestCount: 2,
}

// 1. A sends the booking with KA; response is lost (we abort before reading).
{
  const controller = new AbortController()
  try {
    const res = await fetch('http://localhost:3000/api/v1/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
        'Idempotency-Key': KA,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    await res.text()
  } catch {}
}
await new Promise((r) => setTimeout(r, 400))

// 2. B logs in on the same browser (A logged out) and submits with KB.
const resB = await api('POST', '/bookings', {
  token: tokenB,
  body: payload,
  headers: { 'Idempotency-Key': KB },
})

// 3. A logs back in and retries with KA — must replay A's original booking.
const resAReplay = await api('POST', '/bookings', {
  token: tokenA,
  body: payload,
  headers: { 'Idempotency-Key': KA },
})

// 4. Cross-account contamination probe: B replays with A's key KA.
const crossReplay = await api('POST', '/bookings', {
  token: tokenB,
  body: payload,
  headers: { 'Idempotency-Key': KA },
})

logScenario('S3 result', {
  B_submission: {
    httpStatus: resB.status,
    bookingId: resB.data?.id,
    errorCode: resB.errorCode,
    message: resB.message?.slice?.(0, 120) ?? resB.message,
  },
  A_replay_with_KA: {
    httpStatus: resAReplay.status,
    bookingId: resAReplay.data?.id,
    bookingStatus: resAReplay.data?.status,
    errorCode: resAReplay.errorCode,
  },
  B_replay_with_A_key_KA: {
    httpStatus: crossReplay.status,
    bookingId: crossReplay.data?.id,
    errorCode: crossReplay.errorCode,
    message: crossReplay.message?.slice?.(0, 120) ?? crossReplay.message,
  },
  isolatedBookings: {
    B_has_own: Boolean(resB.data?.id),
    A_replayed_original: Boolean(resAReplay.data?.id),
    crossContaminated: crossReplay.status === 201,
  },
})
