// S10: Account lock/token revocation during active session (customer + staff/admin).
import { api, loginCustomer, loginUser, logScenario } from './helpers.mjs'

const out = {}
const admin = await loginUser('admin@example.com', 'admin123')
const adminToken = admin.data.accessToken

// ---------- Customer lock ----------
const c = await loginCustomer('uat-b@example.com', 'Customer@123')
const tokenB = c.data.accessToken
out.customer = {}

// Token works before lock.
const meBefore = await api('GET', '/auth/me', { token: tokenB })
out.customer.meBeforeLock = { status: meBefore.status, actorType: meBefore.data?.actorType }

// Admin locks customer B.
const lock = await api('PATCH', '/customers/2/status', {
  token: adminToken,
  body: { status: 'LOCKED' },
})
out.customer.lock = { status: lock.status, errorCode: lock.errorCode, message: lock.message?.slice?.(0, 140) ?? lock.message }

// Old token must be rejected on next protected request.
const meAfter = await api('GET', '/auth/me', { token: tokenB })
out.customer.meAfterLock = { status: meAfter.status, errorCode: meAfter.errorCode, message: meAfter.message?.slice?.(0, 120) }

// Login while locked must fail with the lock error code.
const loginLocked = await loginCustomer('uat-b@example.com', 'Customer@123')
out.customer.loginWhileLocked = { status: loginLocked.status, errorCode: loginLocked.errorCode, message: loginLocked.message?.slice?.(0, 140) ?? loginLocked.message }

// Unlock for later scenarios.
const unlock = await api('PATCH', '/customers/2/status', {
  token: adminToken,
  body: { status: 'ACTIVE' },
})
out.customer.unlock = { status: unlock.status, errorCode: unlock.errorCode }

// ---------- Internal user lock (admin locks own kind — use a staff account) ----------
// Provision a staff user via user admin API.
const suffix = Date.now()
const createdUser = await api('POST', '/users', {
  token: adminToken,
  body: {
    fullName: 'UAT Staff Lock',
    email: `uat-staff-${suffix}@example.com`,
    password: 'StaffPass@123',
    role: 'STAFF',
  },
})
out.staffCreate = { status: createdUser.status, id: createdUser.data?.id, errorCode: createdUser.errorCode, message: createdUser.message?.slice?.(0, 140) ?? createdUser.message }
const staffId = createdUser.data?.id

if (staffId) {
  const staffLogin = await loginUser(`uat-staff-${suffix}@example.com`, 'StaffPass@123')
  out.staff = { login: { status: staffLogin.status } }
  const staffToken = staffLogin.data?.accessToken

  if (staffToken) {
    const meStaff = await api('GET', '/auth/me', { token: staffToken })
    out.staff.meBefore = { status: meStaff.status, role: meStaff.data?.user?.role }

    // Lock the staff account.
    const lockStaff = await api('PATCH', `/users/${staffId}/status`, {
      token: adminToken,
      body: { status: 'LOCKED' },
    })
    out.staff.lock = { status: lockStaff.status, errorCode: lockStaff.errorCode, message: lockStaff.message?.slice?.(0, 140) ?? lockStaff.message }

    // Old token rejected.
    const meStaffAfter = await api('GET', '/auth/me', { token: staffToken })
    out.staff.meAfterLock = { status: meStaffAfter.status, errorCode: meStaffAfter.errorCode }

    // Login while locked fails.
    const loginStaffLocked = await loginUser(`uat-staff-${suffix}@example.com`, 'StaffPass@123')
    out.staff.loginWhileLocked = { status: loginStaffLocked.status, errorCode: loginStaffLocked.errorCode, message: loginStaffLocked.message?.slice?.(0, 140) ?? loginStaffLocked.message }
  }
}

logScenario('S10 result', out)
