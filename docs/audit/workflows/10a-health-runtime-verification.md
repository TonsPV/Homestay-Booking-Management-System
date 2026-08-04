# Lượt 10A - Health và runtime jobs

Date: 2026-08-01  
Scope: Liveness/readiness, bounded MySQL probe, failure sanitization, readiness
rate limit, shutdown behavior và Booking/Payment expiration schedulers.

## 1. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| Liveness does not call DB | VERIFIED | Dedicated E2E spies on `HealthDatabaseProbeService.check`; `/api/health/live` succeeds without invoking it. |
| Readiness success | VERIFIED | Dedicated E2E executes the real MySQL pool probe and receives `200`. Existing application E2E covers the same route. |
| Acquire/query timeout and connection lifecycle | VERIFIED / COVERED_BY_UNIT | `HealthDatabaseProbeService` unit suite covers bounded query, query error, timeout before acquisition, concurrent cap, connection destroy/release and shutdown pool close. |
| Readiness failure status/envelope | VERIFIED | Injected probe failure returns `503` with `Database is unavailable.` and no host, credential or internal error text. |
| Readiness rate limit | VERIFIED | Dedicated E2E reaches the configured 30-request bucket and observes `429` with `Retry-After`. Unit tests also cover window reset. |
| Trusted-network deployment policy | PARTIAL | The route is rate-limited, but no repository evidence proves a trusted-network/proxy allowlist for readiness in production. Deployment policy remains external. |
| Booking expiration scheduler | VERIFIED / COVERED_BY_UNIT | Enabled path calls `expirePendingPayments`, disabled path performs no mutation, and structured success/failure logs omit internal error details. Cron metadata uses `EVERY_MINUTE` + `waitForCompletion`. |
| Payment expiration scheduler | VERIFIED / COVERED_BY_UNIT | Enabled path runs online-payment expiry and stale-refund count together; disabled path skips both; structured logs are sanitized. |
| Two process scheduler coordination | PARTIAL / NEEDS_DECISION | `waitForCompletion` prevents overlapping executions in one Nest process. No distributed lock/leader election is present for multiple replicas, so deployment must keep one scheduler replica or add coordination. |
| Stale refund visibility | VERIFIED / COVERED_BY_EXISTING | Payment query/dashboard paths expose stale-refund count; data audit includes a stale-refund invariant. |

## 2. Architecture/design check

- Health probing has a dedicated pool and service rather than sharing the
  application TypeORM unit-of-work. Probe timeout destroys a bad connection;
  successful probes release it.
- `HealthController` maps the probe to a stable public `503` message and does
  not leak the caught error.
- Booking and Payment expiration are thin cron adapters. Business mutation
  remains in Booking/Payment services, and `waitForCompletion` is explicit.
- The current pattern is appropriate for a single scheduler process. A
  multi-replica deployment needs a distributed lock/queue decision; this is not
  safely inferable from local tests.

## 3. Verification commands

| Command | Result |
|---|---|
| `npx jest --config ./test/jest-e2e.json --runInBand test/health-runtime-workflow.e2e-spec.ts` | PASS, 1 suite / 2 tests |
| `npx jest src/common/health src/module/booking/booking-expiration.service.spec.ts src/module/payment/payment-expiration.service.spec.ts --coverage --runInBand` | PASS, 4 suites / 16 tests; health probe 93.33% statements / 83.33% branches; both scheduler services 100% statements |
| `npm run test:e2e -- --runInBand` | PASS in final integration: 20 suites / 98 tests |
| `npm run lint` | PASS in final integration |

## 4. Lượt 10A conclusion

Status: **PASS for local health/probe/runtime-job workflows; distributed
scheduler coordination and production trusted-network policy remain PARTIAL or
NEEDS_DECISION.**

Proceed to Lượt 10B (Common HTTP, security and OpenAPI contract).
