# Codex Security Scan - 2026-07-30

Status: `SCAN COMPLETED / SECURITY ROUND 5 VERIFIED / SEC-001..007,009 CLOSED IN WORKTREE / SEC-008 MITIGATED`

## Scan identity

| Field | Value |
|---|---|
| Repository | `D:\HBMS\homestay-booking-management-system-api` |
| Scan ID | `b91b7090-dac3-4d51-9890-10b6af7c7c21` |
| Target revision | `489ecfbbcc77120fc0a5191a466ba0e37a76ede5` |
| Target state | Dirty worktree snapshot |
| CLI | `@openai/codex-security` 0.1.4 |
| Plugin | `codex-security` 0.1.14 |
| Model | `gpt-5.6-sol`, effort `xhigh` |
| Mode | Repository-wide standard scan |
| Duration | 3,952 seconds |
| Estimated scan cost | USD 58.009426 |

The project-local command skills are installed under `.agents/skills`. Scan
artifacts stay outside the repository at:

`D:\HBMS\codex-security-results\hbms-be`

Primary artifacts:

- `report.md`
- `scan-manifest.json`
- `findings.json`
- `coverage.json`
- `exports/results.sarif`
- `artifacts/02_discovery/candidate_ledger.jsonl`
- `artifacts/03_coverage/repository_coverage_ledger.md`

## Result

- Coverage: 281/281 source-like files, complete.
- Candidates: 15 closed.
- Findings: 9.
- Severity: 1 High, 8 Low.
- Rejected candidates: 6.
- Deferred candidates: 0.
- Focused tests run by the scanner: 49 pass.

The scanner documented these runtime limitations:

- No destructive live MySQL race/interleaving harness.
- No live degraded-MySQL load test.
- No controlled VNPay sandbox response channel.
- Frontend rendering, reverse proxy, TLS termination, network controls and host
  permissions are outside this repository.

## Findings

| Priority | Finding ID | Severity | Summary | Primary source | Remediation owner |
|---|---|---|---|---|---|
| SEC-001 | `csf_052a3b4eed9db84577347c33` | High | A Customer can create unbounded unpaid booking holds and deny future inventory | `src/module/booking/booking-creation.service.ts` | Booking admission policy |
| SEC-002 | `csf_13a5ce02f389847971a9a284` | Low | A stale profile save can restore `status` or `tokenVersion` during a concurrent lock/password change | `src/module/customer/customer-profile.service.ts` | Customer concurrency |
| SEC-003 | `csf_7268c9b5a90165843360451d` | Low | STAFF can race an ADMIN transition to `HIDDEN` and overwrite the protected state | `src/module/room/room-mutation.service.ts` | Room concurrency |
| SEC-004 | `csf_9b877685a31b4defc5006b08` | Low | Customer payment history exposes management/gateway/refund audit metadata | `src/module/payment/payment-query.service.ts` | Payment projection |
| SEC-005 | `csf_d8c7870d2746bb55101eb041` | Low | Public Room endpoints expose exact room number and live occupancy/cleaning state | `src/module/room/room-query.service.ts` | Public Room projection |
| SEC-006 | `csf_a2ba3712fdc5365e7a3c3222` | Low | Customer login reveals account existence and state | `src/module/auth/auth.service.ts` | Auth error normalization |
| SEC-007 | `csf_b6d5b6c79f40b1d2417f300e` | Low | Staff/Admin login reveals privileged account existence and lock state | `src/module/auth/auth.service.ts` | Auth error normalization |
| SEC-008 | `csf_222dd59aedaa6552b03650f7` | Low | Registration confirms whether an email or phone is already registered | `src/module/auth/auth.service.ts` | Registration product flow |
| SEC-009 | `csf_2dfb17129f034210a29d3ccf` | Low | Readiness timeout returns before its database query is cancelled | `src/common/health/health.controller.ts` | Runtime/database health |

SEC-001 disposition: `CLOSED 2026-07-30`. The original one-account inventory
denial path is now bounded by an atomic active-hold quota and advance horizon.
Shared deployment throttling and monitoring remain defense-in-depth follow-up,
not a reason to leave the original unbounded-hold finding open.

SEC-002 and SEC-003 disposition: `CLOSED 2026-07-30`. Profile writes are now
field-limited and version/status conditional. Room status writes are now
conditional on the status used for authorization. A stale writer receives
`409 Conflict` instead of restoring security-sensitive state.

SEC-004 and SEC-005 disposition: `CLOSED 2026-07-30`. Customer Payment and
public Room routes now use explicit boundary-specific DTOs and allowlist
mappers. Management projections retain operational and audit data.

SEC-006 and SEC-007 disposition: `CLOSED 2026-07-30`. Customer and User login
now perform real or dummy scrypt verification before returning one generic
`401` response for every invalid account/password state.

SEC-008 disposition: `MITIGATED 2026-07-30, NOT CLOSED`. The registration
endpoint no longer exposes duplicate email/phone through its direct response,
including duplicate-key races. Full closure requires an out-of-band ownership
verification flow before a newly registered identity can log in. Without that
flow, a caller can still chain registration with a later login attempt to
distinguish a newly created account from an existing identity.

SEC-009 disposition: `CLOSED IN WORKTREE 2026-07-30`. Readiness now uses an
isolated one-connection mysql2 pool, rejects concurrent probes before
acquisition, actively destroys timed-out work, and rate-limits public requests.
Codex Security validation suppressed the finding with medium-high confidence.
The Health files are currently untracked in the shared worktree, so deployment
closure still requires the user to commit and deploy the reviewed changes.

## Independent dependency audit

`npm audit --omit=dev --audit-level=high` currently fails with two High
occurrences of the same advisory:

- Advisory: `GHSA-pm4m-ph32-ghv5`
- Affected package: `js-yaml` 5.2.1
- Dependency path: `@nestjs/swagger@11.4.6 -> js-yaml@5.2.1`
- Patched package version: `js-yaml` 5.2.2
- Current `@nestjs/swagger` latest: 11.4.6 and it still pins 5.2.1.
- `npm audit fix --force` proposes a downgrade to `@nestjs/swagger@11.4.5`;
  this was not run automatically.

## Verification after scan

| Command | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run test -- --runInBand` | PASS, 41 suites / 279 tests |
| `npm audit --omit=dev --audit-level=high` | FAIL, 2 High occurrences of one transitive advisory |

No application source was patched during the scan.

## Remediation sequence

### Security Lượt 1 - Booking admission control

Implementation date: 2026-07-30.

Approved default policy:

1. Maximum 3 active `PENDING_PAYMENT` + `UNPAID` bookings per Customer.
2. Maximum 30 aggregate room-nights held by those bookings.
3. Maximum advance-booking horizon of 365 days.
4. Customer self-service creation is quota controlled. An authorized
   management counter booking is not rejected by this self-service quota, but
   an unpaid counter booking is included when the Customer later requests an
   online booking.

Implemented controls:

- Customer self-service creation locks the Customer row with
  `pessimistic_write` before reading the active-hold budget. Concurrent
  requests for one Customer therefore serialize inside the same transaction.
- Count and aggregate room-night admission checks run before Room locking,
  Booking insertion and RoomCalendar insertion.
- Pending bookings remain in the budget until payment, cancellation or expiry
  changes their state. A merely elapsed timestamp does not release quota before
  lifecycle cleanup has actually released inventory.
- Advance-horizon validation runs before opening the transaction.
- The policy is configurable through:
  - `BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER`
  - `BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER`
  - `BOOKING_MAX_ADVANCE_DAYS`
- Environment validation rejects unsafe or nonsensical configured bounds.

Tests added:

- Unit rejection at the active-booking limit.
- Unit rejection above the aggregate held-night limit.
- Unit rejection beyond the configured advance horizon.
- MySQL E2E scenario with four concurrent, non-overlapping booking requests:
  only three may persist; cancellation then releases exactly one quota slot.

Verification on 2026-07-30:

| Command | Result |
|---|---|
| Targeted Booking + environment unit tests | PASS, 2 suites / 34 tests |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm test -- --runInBand` | PASS, 41 suites / 283 tests |
| Security Lượt 1 MySQL concurrency E2E | PASS: 4 concurrent requests persisted exactly 3 holds; cancellation released 1 quota slot |
| Full `npm run test:e2e -- --runInBand` | PARTIAL, 34/37 pass; the 3 failures are pre-existing User/Auth/Amenity test-isolation assertions and do not involve Booking |
| `npm run openapi:check` | PASS, snapshot current |
| Test DB `npm run schema:check` | PASS, entity metadata matches migrated schema |
| Test DB `npm run data:audit` | PASS, 10/10 invariants with 0 violations |

SEC-001 is closed. The MySQL race test proves the per-Customer transaction lock
prevents the quota from being exceeded and that cancellation releases capacity.
The route and DTO contract did not change.

The database selected by the default `.env` still has migrations
`1784782000000` and `1784783000000` pending and therefore reports schema drift.
Those migrations predate and are unrelated to Security Lượt 1; they were not
run automatically. The `.env.test` database used for E2E is fully migrated and
passes schema drift and data audit checks.

Deployment follow-up:

- Use a shared per-Customer/IP request limiter when more than one API instance
  is deployed. The repository's current in-memory limiter is not a distributed
  control.
- Alert on pending-booking count, held room-nights, quota rejections and expiry
  backlog. The existing expiry worker drains 100 bookings per minute, while the
  new invariant bounds one Customer to three active unpaid holds.

### Security Lượt 2 - Concurrency containment

Implementation date: 2026-07-30.

Implemented controls:

1. Customer profile updates use a field allowlist containing only `fullName`,
   `email` and `phone`.
2. The profile update predicate requires the original `tokenVersion`,
   `ACTIVE` status and a non-deleted Customer. It never writes `status`,
   `tokenVersion`, `passwordHash` or other authorization fields.
3. Room status updates require the persisted Room to still have the status
   against which the role transition was authorized.
4. Zero affected rows return `409 Conflict`, requiring the caller to reload
   current state before retrying.
5. Route names, enum values, success response shapes and database columns are
   unchanged.

Deterministic race coverage:

- A Customer profile request is paused after reading the active account.
  ADMIN locks the account and increments `tokenVersion`; the stale profile
  request resumes, receives `409`, cannot change the name, cannot restore
  `ACTIVE`, and the old token remains rejected.
- A STAFF Room transition is paused after reading `READY`. ADMIN commits
  `HIDDEN`; the stale STAFF transition resumes, receives `409`, and the Room
  remains `HIDDEN`.
- Unit tests assert conditional predicates, field allowlists and zero-row
  conflict behavior directly.

Baseline E2E corrections completed before remediation:

- User search uses the test's unique email instead of a broad phrase that
  matched persistent fixtures.
- Auth rate-limit E2E observes the first `429` without depending on request
  count from a previous test; it still asserts `Retry-After`.
- Amenity E2E now honors the existing rule that an assigned Amenity returns
  `409`, removes the relation before deletion, then restores and reassigns it.

Verification:

| Command | Result |
|---|---|
| Customer + Room targeted unit tests | PASS, 2 suites / 20 tests |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm test -- --runInBand` | PASS, 41 suites / 285 tests |
| `npm run test:e2e -- --runInBand` | PASS, 1 suite / 39 tests |
| `npm run openapi:check` | PASS, snapshot current |
| Test DB `npm run schema:check` | PASS |
| Test DB `npm run data:audit` | PASS, 10/10 invariants with 0 violations |

SEC-002 and SEC-003 are closed.

### Security Lượt 3 - Response projection boundaries

Implementation date: 2026-07-30.

Customer Payment boundary:

- Added `CustomerPaymentDto` and `CustomerPaymentResponse`.
- Customer history queries no longer join `createdByUser` or
  `refundedByUser`.
- Customer history and VNPay creation return only payment identity, amount,
  method/status, safe merchant reference and customer-facing timestamps.
- Operator IDs/names, gateway transaction codes, refund request/reconciliation
  fields and management audit timestamps remain in `PaymentDto` for management
  endpoints.
- Ownership behavior remains unchanged: another Customer's booking is returned
  as `404`.

Public Room boundary:

- Added `PublicRoomDto` and `PublicRoomResponse`.
- Public list/search/detail omit `roomNumber`, `status`, `createdAt` and
  `updatedAt`.
- Public text search no longer searches the physical `roomNumber` field.
- Management list/detail and mutation responses continue using `RoomDto` with
  physical room number and operational status.
- Public polling during real `OCCUPIED` and `CLEANING` lifecycle states is
  covered by E2E and cannot observe either state or the physical number.

Contract coordination:

- Regenerated `docs/openapi.json`.
- Added the FE migration contract to `docs/FRONTEND_ROADMAP.md`.
- FE must regenerate its client before migrating public Room and customer
  Payment screens. This is an intentional breaking response change.

Verification:

| Command | Result |
|---|---|
| Payment + Room targeted unit tests | PASS, 3 suites / 33 tests |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm test -- --runInBand` | PASS, 41 suites / 286 tests |
| `npm run test:e2e -- --runInBand` | PASS, 1 suite / 39 tests |
| `npm run openapi:generate` | PASS |
| `npm run openapi:check` | PASS, snapshot current |
| Test DB `npm run schema:check` | PASS |
| Test DB `npm run data:audit` | PASS, 10/10 invariants with 0 violations |

SEC-004 and SEC-005 are closed.

### Security Lượt 4 - Authentication enumeration

Implementation date: 2026-07-30.

Login controls:

1. Customer and User login return the same external
   `401 Unauthorized / Thong tin dang nhap khong hop le.` contract for missing,
   locked, passwordless and password-mismatch states.
2. Missing, null and malformed hashes are replaced with a valid constant-format
   scrypt dummy hash. Locked accounts still verify their real hash before the
   generic rejection.
3. Tokens are signed only after password verification and an `ACTIVE` status
   check.
4. Internal rejection logs contain actor type and a reason category, but never
   the submitted email, phone or password.
5. Existing per-route login limits remain 10 attempts per 15 minutes. The
   current limiter remains process-local; a shared store is still required for
   multi-instance deployment.

Registration response controls:

1. New, duplicate-email and duplicate-phone requests all return
   `201 Created` with message `Yeu cau dang ky da duoc tiep nhan.` and
   `data: { "accepted": true }`.
2. Duplicate requests perform the same password hashing work and return no
   existing Customer data.
3. MySQL duplicate-key races are normalized to the same public response.
4. The old identifier-specific `409` responses and Customer profile response
   were removed from this public route.
5. `docs/openapi.json` and the FE migration guidance were updated.

Residual SEC-008 requirement:

- The repository intentionally has no fake email/SMS provider or OTP workflow.
- A new Customer is still created as `ACTIVE`, so registration followed by
  login remains an indirect membership oracle.
- SEC-008 therefore stays open until a real ownership-verification provider,
  pending registration state, expiring one-time challenge, resend/rate-limit
  policy and activation E2E flow are implemented.

Verification:

| Command | Result |
|---|---|
| Targeted Auth + password-hasher unit tests | PASS, 2 suites / 23 tests |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm test -- --runInBand` | PASS, 41 suites / 293 tests |
| `npm run test:e2e -- --runInBand` | PASS, 1 suite / 39 tests |
| Login failure equivalence E2E | PASS for Customer/User missing, locked and wrong-password; Customer passwordless also covered |
| Registration equivalence E2E | PASS for new, duplicate email and duplicate phone |
| `npm run openapi:check` | PASS, snapshot current |
| Test DB `npm run schema:check` | PASS |
| Test DB `npm run data:audit` | PASS, 10/10 invariants with 0 violations |
| `codex-security validate ... --effort high` | PASS: SEC-006 and SEC-007 suppressed with High confidence; SEC-008 remains reportable with High static confidence |

SEC-006 and SEC-007 are closed. SEC-008's direct response oracle is mitigated,
but the finding is not marked closed until real out-of-band verification exists.

### Security Lượt 5 - Readiness resource bounds

Implementation date: 2026-07-30.

Implemented controls:

1. Replaced `Promise.race(DataSource.query(), timer)` with
   `HealthDatabaseProbeService`.
2. Readiness has a dedicated mysql2 pool configured with:
   - `connectionLimit: 1`
   - `maxIdle: 1`
   - `waitForConnections: false`
   - bounded `connectTimeout`
   - no multiple statements
3. Only one readiness probe may run at a time. Excess concurrent probes return
   sanitized `503` without calling `getConnection`.
4. The probe applies both mysql2 query timeout and MySQL
   `MAX_EXECUTION_TIME`, plus its own end-to-end deadline.
5. Timeout, query error and late acquisition paths call `destroy()` rather
   than returning an uncertain connection to the pool.
6. Successful probes release the connection normally. Application shutdown
   aborts active probe work and closes the dedicated pool.
7. `GET /api/health/ready` is limited to 30 requests per minute per process/IP.
   Liveness remains independent from the database and is not rate-limited.
8. The application TypeORM pool now has explicit connection timeout, pool size,
   idle limit and bounded queue configuration.

Configuration:

- `HEALTH_DB_PROBE_TIMEOUT_MS=1000`
- `DB_CONNECT_TIMEOUT_MS=5000`
- `DB_POOL_SIZE=10`
- `DB_POOL_QUEUE_LIMIT=50`

Verification:

| Command | Result |
|---|---|
| Targeted Health + environment unit tests | PASS, 3 suites / 21 tests |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm test -- --runInBand` | PASS, 42 suites / 300 tests |
| `npm run test:e2e -- --runInBand` | PASS, 3 suites / 41 tests |
| Deterministic degraded-DB E2E | PASS: 12 excess probes started 0 additional acquisitions; timeout destroyed the active connection; next probe recovered |
| Real MySQL stalled-query E2E | PASS: `SELECT SLEEP(2)` was terminated before the 1500 ms test bound and the one-slot pool was immediately reusable |
| `npm run openapi:check` | PASS, readiness documents `200`, `429`, and `503` |
| Test DB `npm run schema:check` | PASS |
| Test DB `npm run data:audit` | PASS, 10/10 invariants with 0 violations |
| `codex-security validate ... --effort high` | SUPPRESSED SEC-009 with medium-high confidence |

Deployment follow-up:

- Restrict `/api/health/ready` to the orchestrator, load balancer or trusted
  monitoring network. Repository code cannot enforce the deployment network
  boundary.
- Use a shared rate-limit store if readiness is exposed through multiple API
  instances.
- Commit and deploy the currently untracked Health remediation files before
  treating SEC-009 as operationally closed.

SEC-009 is closed for the current working tree.

### Security Lượt 6 - Supply-chain remediation

Choose and verify one non-breaking path:

1. Upgrade `@nestjs/swagger` when it depends on `js-yaml >= 5.2.2`.
2. Use a narrowly scoped npm override to 5.2.2 after Swagger generation,
   OpenAPI drift, unit and E2E compatibility tests.
3. Downgrade to 11.4.5 only after separately proving there is no contract or
   generator regression.

Do not run `npm audit fix --force` without reviewing the resulting dependency
diff.

## Close criteria

- SEC-001 has an explicit approved booking admission policy and atomic tests.
- SEC-002 and SEC-003 have deterministic race tests.
- Public/customer response projections are documented and FE contract is
  regenerated.
- Auth external failures no longer expose account state.
- Readiness work is bounded beyond JavaScript response timeout.
- Production dependency audit has no unresolved High advisory, or an explicit
  time-bounded risk acceptance exists.
- Build, lint, unit, E2E, OpenAPI check, migration/schema check and data audit
  all pass.
