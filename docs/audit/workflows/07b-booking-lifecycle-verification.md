# Lượt 7B - Booking lifecycle and expiration verification

Date: 2026-08-01  
Scope: Booking state transitions, payment/state gates, Room occupancy effects,
customer cancellation, terminal states, early checkout characterization, and
pending-payment expiration.

## 1. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| PENDING_PAYMENT → CONFIRMED for online UNPAID | VERIFIED | Management status request returns `409`; no state transition is committed. |
| PENDING_PAYMENT → CONFIRMED for counter UNPAID | CHARACTERIZED | Existing counter exception is accepted (`200`) when `createdByUserId` is present; retained as current behavior. |
| CONFIRMED → CHECKED_IN payment/date/Room gate | VERIFIED | PAID booking outside stay date returns `409`; PAID booking on current Vietnam stay date and READY Room succeeds. |
| Check-in Room side effect | VERIFIED | Successful check-in changes Room `READY → OCCUPIED`. |
| CHECKED_IN → CHECKED_OUT Room side effect | VERIFIED | Successful checkout changes Room `OCCUPIED → CLEANING`. |
| HIDDEN/MAINTENANCE checkout exception | COVERED_BY_UNIT | Existing Booking service unit cases preserve those statuses; dedicated E2E does not repeat the same side effect. |
| Customer ownership cancellation | VERIFIED | Non-owner receives `404`; owner can cancel an unpaid booking. |
| Cancellation reason normalization and calendar release | VERIFIED | Trimmed reason is persisted; RESERVED calendar rows are removed. |
| Paid cancellation protection | VERIFIED | Customer cancellation of a PAID booking returns `409`. |
| CHECKED_OUT/CANCELLED terminal states | VERIFIED | Other transitions return `409`; same-status requests are idempotent `200`. |
| Early checkout before planned check-out date | NEEDS_DECISION | Current implementation accepts immediate checkout after check-in (`200`). The plan explicitly requires product policy before changing it. |
| Pending unpaid expiry | VERIFIED | Expired PENDING_PAYMENT + UNPAID booking becomes CANCELLED, gets `Payment expired.` reason, and releases calendar rows. Repeated expiration returns `0`. |
| Batch >100 and backlog | PARTIAL | Unit characterization verifies `.take(100)`; dedicated MySQL run exercised expiration and idempotency but not a 101-row backlog. |
| Two independent scheduler processes | PARTIAL / NEEDS_DECISION | Cron uses `waitForCompletion`, which serializes calls in one process; no distributed lock evidence exists for multiple replicas. |
| `data:audit` after lifecycle flow | VERIFIED | Test DB audit remains 10/10 invariants with 0 violations after the workflow suites. |

## 2. Architecture/design check

- `BookingLifecycleService` owns the state machine, cancellation, expiration,
  Payment failure-on-cancel/expiry, and Room transition in a TypeORM
  transaction. `BookingService` remains a facade.
- Each lifecycle mutation locks the Booking; check-in/out also locks the Room
  before changing its status. Calendar release is part of the same transaction.
- The direct E2E fixtures are scoped and cleaned through `E2eHarness`; no
  production route or schema change was needed in this slice.
- Cross-module state ownership remains the main architecture decision: direct
  Room status API can still conflict with a CHECKED_IN Booking (WF-RISK-001
  carried from Lượt 6B).

## 3. Verification commands

| Command | Result |
|---|---|
| `npx jest --config ./test/jest-e2e.json --runInBand test/booking-lifecycle-workflow.e2e-spec.ts` | PASS, 1 suite / 4 tests |
| `npm run test:e2e -- --runInBand` | PASS, 14 suites / 82 tests |
| `npm run test -- --runInBand` | PASS, 42 suites / 302 tests |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run openapi:validate` | PASS; snapshot current, 4 contract tests |
| `npm run data:audit` | PASS, 10/10 invariants with 0 violations |

## 4. Lượt 7B conclusion

Status: **PASS for tested lifecycle/cancel/expiry workflows; PARTIAL for
large-batch and multi-process scheduler evidence; NEEDS_DECISION for early
checkout and counter-unpaid confirmation policy**.

Proceed to Lượt 7C (Booking architecture gate) before Payment, preserving the
facade/capability split and measuring the actual creation/lifecycle/query
branches rather than only the facade coverage.
