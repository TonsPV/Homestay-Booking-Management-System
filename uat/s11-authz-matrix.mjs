// S11: Authorization matrix (Guest/Customer/Staff/Admin) + unified login behavior.
import { api, loginCustomer, loginUser, logScenario } from './helpers.mjs'

const out = { matrix: [], unifiedLogin: [] }

const admin = await loginUser('admin@example.com', 'admin123')
const adminToken = admin.data.accessToken
const customer = await loginCustomer('uat-a@example.com', 'Customer@123')
const customerToken = customer.data.accessToken

// Provision a fresh staff account for the matrix.
const suffix = Date.now()
const createdStaff = await api('POST', '/users', {
  token: adminToken,
  body: {
    fullName: 'UAT Staff Matrix',
    email: `uat-matrix-${suffix}@example.com`,
    password: 'StaffPass@123',
    role: 'STAFF',
  },
})
const staffLogin = await loginUser(`uat-matrix-${suffix}@example.com`, 'StaffPass@123')
const staffToken = staffLogin.data?.accessToken

const guestToken = null

// [actor, token, route, method, expectAllowed]
const probes = [
  ['GUEST', guestToken, '/bookings?limit=5&page=1', 'GET', false],
  ['GUEST', guestToken, '/management/payments?limit=5&page=1', 'GET', false],
  ['CUSTOMER', customerToken, '/bookings?limit=5&page=1', 'GET', true],
  ['CUSTOMER', customerToken, '/management/payments?limit=5&page=1', 'GET', false],
  ['CUSTOMER', customerToken, '/management/bookings?limit=5&page=1', 'GET', false],
  ['CUSTOMER', customerToken, '/users?limit=5&page=1', 'GET', false],
  ['STAFF', staffToken, '/management/payments?limit=5&page=1', 'GET', true],
  ['STAFF', staffToken, '/management/bookings?limit=5&page=1', 'GET', true],
  ['STAFF', staffToken, '/users?limit=5&page=1', 'GET', false],
  ['STAFF', staffToken, '/management/payments/5/refund', 'POST', false],
  ['ADMIN', adminToken, '/management/payments?limit=5&page=1', 'GET', true],
  ['ADMIN', adminToken, '/users?limit=5&page=1', 'GET', true],
  ['ADMIN', adminToken, '/customers?limit=5&page=1', 'GET', true],
]

for (const [actor, token, route, method, expectAllowed] of probes) {
  const r = await api(method, route, { token: token ?? undefined, body: method === 'POST' ? { reason: 'probe' } : undefined })
  const allowed = r.status < 400
  out.matrix.push({
    actor,
    route,
    method,
    status: r.status,
    errorCode: r.errorCode ?? null,
    expectAllowed,
    verdict: allowed === expectAllowed ? 'OK' : 'MISMATCH',
  })
}

// ---- Unified login product behavior ----
async function unifiedProbe(label, identifier, password) {
  const customerAttempt = await api('POST', '/auth/customers/login', { body: { identifier, password } })
  const userAttempt = await api('POST', '/auth/users/login', { body: { identifier, password } })
  out.unifiedLogin.push({
    label,
    customerEndpoint: { status: customerAttempt.status, errorCode: customerAttempt.errorCode ?? null },
    userEndpoint: { status: userAttempt.status, errorCode: userAttempt.errorCode ?? null },
    // FE unified flow: customer 401 -> try user endpoint.
    resolved: customerAttempt.status === 200 ? 'customer' : userAttempt.status === 200 ? 'user' : 'failure',
  })
}

await unifiedProbe('valid customer', 'uat-a@example.com', 'Customer@123')
await unifiedProbe('valid admin', 'admin@example.com', 'admin123')
await unifiedProbe('valid staff', `uat-matrix-${suffix}@example.com`, 'StaffPass@123')
await unifiedProbe('invalid password (customer identity)', 'uat-a@example.com', 'WrongPass@123')
await unifiedProbe('invalid password (user identity)', 'admin@example.com', 'WrongPass@123')
await unifiedProbe('unknown identifier', `nobody-${suffix}@example.com`, 'Whatever@123')

logScenario('S11 result', out)
