# Lượt 1 - Auth workflow verification

> Amendment 2026-08-02: duplicate email/phone registrations now return a generic
> `409 Conflict` instead of a misleading `201 accepted`. A real new registration
> still returns `201` and can log in immediately. The workflow evidence below
> describes the earlier 2026-08-01 contract where explicitly noted.

Date: 2026-08-01  
Scope: `src/module/auth`, shared account authorization readers, public Auth routes,
and the dedicated MySQL E2E fixture scope. No production Auth rule was changed in
this round; the changes are test-lifecycle and evidence only.

## 1. Executed surface

| Surface | Source |
|---|---|
| Customer registration | `src/module/auth/auth.controller.ts`, `AuthService.registerCustomer()` |
| Customer login | `AuthService.loginCustomer()` |
| User login | `AuthService.loginUser()` |
| Current identity | `AuthService.getMe()` and `AccessTokenGuard` |
| JWT | `src/module/auth/access-token.service.ts` |
| Password verification | `src/module/auth/password-hasher.service.ts` |
| Rate limit | `src/common/http/rate-limit.guard.ts` |
| Contract | `docs/openapi.json` and `src/openapi/api-response.decorators.ts` |
| Independent E2E | `test/auth-workflow.e2e-spec.ts` with `test/e2e-harness.ts` |

The new suite owns its customer/user IDs and registers one cleanup scope. It runs
standalone against MySQL without IDs or tokens from `app.e2e-spec.ts`.

## 2. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| New customer registration | VERIFIED for current contract | Dedicated E2E confirms trimmed name, lowercase email, canonical phone, `201`, and `{accepted:true}`. |
| Duplicate email and duplicate phone | VERIFIED for current contract | Both requests return the same accepted envelope and create no second matching account. |
| Duplicate-key race | VERIFIED | Two concurrent MySQL registration requests return the accepted envelope; exactly one account remains. |
| Registration to login membership | VERIFIED as current behavior | The newly created account logs in immediately. This also proves the residual ownership-verification gap below. |
| Customer login normalization | VERIFIED | Formatted local phone logs in and produces a customer JWT. |
| Customer missing/wrong/locked/passwordless/malformed hash | VERIFIED | Five live requests all return the same public `401` contract; scrypt dummy verification remains in the service. |
| User login | VERIFIED | Dedicated E2E signs a user token with the DB role and token version. Existing unit coverage also covers missing/locked/wrong-password states. |
| JWT actor/subject/role/version/tamper | VERIFIED | Token payload is re-read; tampered and malformed bearer headers are rejected; current DB role is reflected by `/auth/me`. |
| Token revocation | VERIFIED | Incrementing customer/user `tokenVersion` makes the old bearer token fail with `401`. |
| Locked account access | VERIFIED | A matching-version locked customer token is rejected by the guard with `403`. |
| `/auth/me` anonymous/trailing token | VERIFIED | Dedicated E2E covers missing, trailing-data, and tampered authorization headers. |
| Login rate limit and `Retry-After` | VERIFIED | Dedicated E2E observes `429`; `src/common/http/rate-limit.guard.spec.ts` verifies exact limit/window behavior and header calculation. |
| `/auth/me` OpenAPI `429` | VERIFIED | Runtime document contains `429` for `GET /api/v1/auth/me`; `npm run openapi:validate` passes. |

## 3. Commands and regression result

| Command | Result |
|---|---|
| `npx jest --config ./test/jest-e2e.json --runInBand test/auth-workflow.e2e-spec.ts` | PASS, 1 suite / 4 tests |
| `npm run test:e2e -- --runInBand` | PASS, 4 suites / 45 tests |
| `npm test -- --runInBand` | PASS, 42 suites / 302 tests |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run openapi:validate` | PASS, snapshot plus 4 contract tests |

The full E2E output still logs the deliberate `Simulated VNPay timeout` fixture in
the payment suite; it is not an Auth failure and all 45 tests pass.

## 4. Findings and gaps

### AUTH-GAP-001 - ownership verification remains open

Status: **GAP_EVIDENCE / P1 security decision required**.

`AuthService.registerCustomer()` currently persists a new customer with
`status: 'ACTIVE'`, and the dedicated E2E can immediately log in that account.
The repository contains no email/SMS provider, pending-registration state,
one-time challenge, expiry, resend policy, or verification endpoint. This is the
same residual SEC-008 described by the security report; it is not safe to invent a
provider or silently change activation semantics in this audit round.

Required next decision: implement a real ownership-verification flow, or record an
explicit accepted-risk scope and owner. Until then, Auth registration must not be
reported as fully security-verified.

### AUTH-GAP-002 - rate limiting is process-local

Status: **GAP_EVIDENCE / deployment architecture**.

`RateLimitGuard` stores buckets in an in-process `Map`. It is correct for the
current single-process test topology, but it cannot enforce one account/IP window
across multiple API replicas. A shared store and trusted-proxy/IP policy are
required before multi-replica deployment; this belongs to the Common HTTP/
architecture round, not an Auth-only hotfix.

### AUTH-STRUCT-001 - E2E ownership is improved but not fully migrated

Status: **PARTIAL**.

Auth now has a standalone suite and scoped cleanup, while the original
`app.e2e-spec.ts` remains a large shared workflow file. This is a test-structure
debt, not evidence of an Auth runtime defect. Further domain rounds should migrate
only the module under audit and keep the shared harness as the sole migration/
cleanup gate.

## 5. Architecture and design-pattern check

- `AuthController` maps HTTP DTOs, guards, rate-limit metadata, and response
  envelopes; it does not own persistence rules.
- `AuthService` owns registration/login/current-identity policy (456 lines),
  while JWT signing/verifying, password hashing, and DB authorization reads are
  separate injectable seams with direct tests.
- The existing guard/decorator pattern is consistent with repository rules:
  `AccessTokenGuard`, `@CurrentAuth`, and `RateLimitGuard` are reused; no new
  authorization pattern was introduced.
- No Auth-specific circular dependency, duplicate file, or safe deletion target
  was proven by this round. Splitting `AuthService` further would be a refactor,
  not an evidence-backed defect fix.

## 6. Lượt 1 conclusion

Status: **PASS for implemented Auth workflows; PARTIAL for security closure and
full suite decomposition**.

All currently implemented Auth state transitions and public contracts have direct
unit, contract, and standalone MySQL E2E evidence. AUTH-GAP-001 remains open by
design until a product/security decision supplies ownership verification. The next
planned round is Lượt 2 (User), with the same fixture ownership and concurrency
discipline.
