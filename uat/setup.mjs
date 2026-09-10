// UAT setup: login admin, create room type + 2 rooms, register 2 customers.
import { api, loginUser } from './helpers.mjs'

const out = {}

// 1. Admin login
const admin = await loginUser('admin@example.com', 'admin123')
if (!admin.data?.accessToken) {
  console.error('ADMIN LOGIN FAILED', admin)
  process.exit(1)
}
out.adminLogin = { status: admin.status, role: admin.data.user?.role }
const adminToken = admin.data.accessToken

// 2. Create room type
const rt = await api('POST', '/admin/room-types', {
  token: adminToken,
  body: {
    name: `UAT Suite ${Date.now()}`,
    description: 'UAT test room type',
    basePrice: '1500000.00',
    maxGuests: 2,
    beds: [{ type: 'QUEEN', quantity: 1 }],
  },
})
out.roomType = {
  status: rt.status,
  id: rt.data?.id,
  error: rt.errorCode,
  message: rt.message?.slice?.(0, 200) ?? rt.message,
}
const roomTypeId = rt.data?.id

// 3. Create two rooms under /management/rooms
const rooms = []
for (const [roomNumber, name] of [
  ['UAT-101', 'UAT Room 101'],
  ['UAT-102', 'UAT Room 102'],
]) {
  const r = await api('POST', '/rooms', {
    token: adminToken,
    body: { roomNumber, name, roomTypeId, status: 'READY' },
  })
  rooms.push({
    status: r.status,
    id: r.data?.id,
    number: roomNumber,
    error: r.errorCode,
    message: r.message?.slice?.(0, 160) ?? r.message,
  })
}
out.rooms = rooms

// 4. Register two customers (VN mobile: 09xxxxxxxx / +84 9xxxxxxxx)
const customers = []
for (const [email, name] of [
  ['uat-a@example.com', 'UAT Customer A'],
  ['uat-b@example.com', 'UAT Customer B'],
]) {
  const phone = `+8491${Math.floor(1000000 + Math.random() * 8999999)}`
  const reg = await api('POST', '/auth/customers/register', {
    body: {
      email,
      fullName: name,
      phone,
      password: 'Customer@123',
    },
  })
  const login = await api('POST', '/auth/customers/login', {
    body: { identifier: email, password: 'Customer@123' },
  })
  customers.push({
    email,
    phone,
    registerStatus: reg.status,
    registerError: reg.errorCode,
    regMessage: reg.message?.slice?.(0, 160) ?? reg.message,
    loginStatus: login.status,
    customerId: login.data?.customer?.id,
    hasToken: Boolean(login.data?.accessToken),
  })
}
out.customers = customers

console.log(JSON.stringify(out, null, 2))
