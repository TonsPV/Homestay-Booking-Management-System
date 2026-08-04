# Lượt 0B - Shared MySQL E2E harness verification

Date: 2026-08-01  
Scope: test lifecycle only; no production business rule or database migration was changed.

## 1. Changes applied

| File | Change | Purpose |
|---|---|---|
| `test/e2e-harness.ts` | Added `E2eHarness` | Centralizes the `_test` safety assertion, one-time TypeORM migration lifecycle, cleanup entry point, LIFO cleanup registration, and unique fixture suffix generation. |
| `test/app.e2e-spec.ts` | Uses `E2eHarness.initialize()` and `E2eHarness.cleanup()` | Removes suite-local migration bootstrapping and puts destructive cleanup behind the same safety gate. |
| `test/jest-e2e.json` | `maxWorkers: 1` | Prevents E2E suites from migrating or mutating the same MySQL test database in parallel. |

The harness calls `assertSafeE2eEnvironment` before both migration and cleanup. The guard
still requires `NODE_ENV=test` and a database name ending in `_test`.

## 2. Verification commands

| Command | Result | Evidence |
|---|---|---|
| `npm run lint` | PASS | ESLint exit code 0 after harness change. |
| `npm run build` | PASS | Nest build exit code 0 after harness change. |
| `npm run test:e2e -- --runInBand` | PASS | 3 suites, 41 tests passed. |

The E2E output contains `Simulated VNPay timeout` from the deliberate refund-failure
fixture at `test/app.e2e-spec.ts`; the test suite still passes and this is not a harness
failure.

## 3. Safety and isolation result

| Check | Status | Evidence/limitation |
|---|---|---|
| Safety guard before migration | VERIFIED | `E2eHarness.initialize()` asserts before `initialize()`/`runMigrations()`. |
| Safety guard before destructive cleanup | VERIFIED | `E2eHarness.cleanup()` asserts before the legacy cleanup callback and registered callbacks. |
| Shared migration owner | VERIFIED | `app.e2e-spec.ts` no longer initializes or runs migrations directly. |
| Shared cleanup entry point | VERIFIED | Legacy cleanup is invoked through `E2eHarness.cleanup()`, with LIFO registration available for module suites. |
| Parallel migration/cleanup protection | VERIFIED | E2E Jest config now forces one worker. |
| Fixture ownership handles for every module | NOT_RUN | The current 39-block application suite still owns shared IDs/tokens and has not yet been split by domain. |
| Random-order or standalone-module execution | NOT_RUN | Current suite is intentionally order-dependent; this is the next refactor gate, not evidence of a defect. |

## 4. Lượt 0B conclusion

Status: **PARTIAL - bootstrap/cleanup safety verified; module isolation not yet complete**.

The required full-suite regression gate is green (41/41). The repository is ready to
begin the first domain audit, but later reports must not claim that module suites are
independent until the Auth slice has its own fixture scope and can run without relying on
tokens or IDs created by an earlier test block.

No migration was applied to the development database. The schema drift and dependency
findings from `00a-current-baseline.md` remain open and are not changed by this test-only
round.

## 5. Next action

Proceed to Lượt 1 (Auth): extract an Auth-scoped fixture, then verify registration,
normalization, login failure uniformity, token revocation, actor/role access, rate limits,
OpenAPI 429 metadata, and registration-to-login ownership semantics against the current
implementation.
