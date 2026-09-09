// S1: Two customers compete for the same room & stay dates.
import { api, loginCustomer, loginUser, logScenario } from './helpers.mjs'

const CHECK_IN = '2026-09-30'
const CHECK_OUT = '2026-10-02'

const admin = await loginUser('admin@example.com', 'admin123')
const adminToken = admin.data.accessToken

// Both customers must see the room available before submitting.
const availA = await api(
  'GET',
  `/management/rooms/available?roomTypeId=2&checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&guests=2`,
  { token: adminToken },
)
const availB = await api(
  'GET',
  `/management/rooms/available?roomTypeId=2&checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&guests=2`,
  { token: adminToken },
)
const availableRooms = availA.data ?? []
const roomId = availableRooms[0]?.id
logScenario('Precondition: room availability seen by both', {
  statusA: availA.status,
  statusB: availB.status,
  availableRooms: availableRooms.map((r) => ({ id: r.id, number: r.roomNumber })),
})
if (!roomId) {
  console.error('NO ROOM AVAILABLE — cannot run S1')
  process.exit(1)
}

const a = await loginCustomer('uat-a@example.com', 'Customer@123')
const b = await loginCustomer('uat-b@example.com', 'Customer@123')
const tokenA = a.data.accessToken
const tokenB = b.data.accessToken

const payload = {
  roomId: String(roomId),
  checkInDate: CHECK_IN,
  checkOutDate: CHECK_OUT,
  guestCount: 2,
}

// Fire both create-booking requests near-simultaneously.
const [resA, resB] = await Promise.all([
  api('POST', '/bookings', { token: tokenA, body: payload }),
  api('POST', '/bookings', { token: tokenB, body: payload }),
])

const summary = {
  A: {
    status: resA.status,
    bookingId: resA.data?.id,
    bookingStatus: resA.data?.status,
    errorCode: resA.errorCode,
    message: resA.message?.slice?.(0, 120) ?? resA.message,
  },
  B: {
    status: resB.status,
    bookingId: resB.data?.id,
    bookingStatus: resB.data?.status,
    errorCode: resB.errorCode,
    message: resB.message?.slice?.(0, 120) ?? resB.message,
  },
}

// Authoritative state: bookings for room + room calendar rows.
const roomBookings = await api(
  'GET',
  `/management/rooms/${roomId}/calendar?from=${CHECK_IN}&to=${CHECK_OUT}`,
  { token: adminToken },
)
summary.calendar = {
  status: roomBookings.status,
  entries: (roomBookings.data ?? []).map((e) => ({
    bookingId: e.bookingId,
    roomId: e.roomId,
    status: e.status,
    from: e.checkInDate,
    to: e.checkOutDate,
  })),
}

const mgmtBookings = await api(
  'GET',
  `/management/bookings?limit=20&page=1`,
  { token: adminToken },
)
summary.activeBookingsForDates = (mgmtBookings.data ?? [])
  .filter(
    (bk) =>
      String(bk.room?.id ?? bk.roomId) === String(roomId) &&
      bk.checkInDate === CHECK_IN,
  )
  .map((bk) => ({ id: bk.id, status: bk.status, roomId: bk.room?.id ?? bk.roomId }))

logScenario('S1 result', summary)
