// UAT helper: shared HTTP helpers for scenario scripts.
// Run with: node scripts/uat-helpers.mjs
const API = 'http://localhost:3000/api/v1'

export async function api(method, path, { token, body, headers, raw } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (raw) return { status: res.status, json }
  return { status: res.status, ...json }
}

export async function loginCustomer(identifier, password = 'Customer@123') {
  const r = await api('POST', '/auth/customers/login', { body: { identifier, password } })
  return r
}

export async function loginUser(identifier, password) {
  const r = await api('POST', '/auth/users/login', { body: { identifier, password } })
  return r
}

export function logScenario(name, data) {
  console.log(`\n=== ${name} ===`)
  console.log(JSON.stringify(data, null, 2))
}
