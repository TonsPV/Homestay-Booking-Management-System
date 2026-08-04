# Lượt 8A - Payment query and manual-payment verification

Date: 2026-08-01  
Scope: Customer/management payment projections, ownership, manual CASH and
BANK_TRANSFER, idempotency, Booking lock, pending VNPay guard, and concurrent
single-success behavior.

## 1. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| Customer payment list ownership | VERIFIED | Owner lists the payment; another Customer receives `404` through Booking ownership scope. |
| Customer projection boundary | VERIFIED | Customer payload contains booking/payment basics but omits management fields such as `gatewayName` and `createdByUserId`. |
| Management payment list/detail | VERIFIED | STAFF lists payments for a Booking and global management list returns stale-refund metadata. |
| Manual CASH/BANK_TRANSFER validation | VERIFIED | Missing `Idempotency-Key` returns `400`; both methods are accepted only on the manual route. |
| Manual payment amount/currency | VERIFIED | Amount equals Booking snapshot (`200.00` in the dedicated fixture) and currency is `VND`. |
| Booking lock/state side effect | VERIFIED | Successful manual payment is `SUCCESS`, sets Booking `PAID`, and auto-confirms `PENDING_PAYMENT` to `CONFIRMED`. |
| Idempotent replay | VERIFIED | Same key + same request returns the same Payment ID with `201`; same key + different method returns `409`. |
| Pending VNPay blocks manual payment | VERIFIED | A real pending VNPay row causes manual CASH to return `409`. |
| Concurrent manual requests | VERIFIED | Same Booking/key concurrent requests both return `201` with one Payment ID; DB has exactly one `SUCCESS` row. |
| Missing/paid/refunded/cancelled/checked-out matrix | COVERED_BY_EXISTING | Existing application E2E and Payment/Booking unit suites cover the remaining Booking-state guards; this slice keeps the new suite narrow and does not re-label them as a new independent gate. |
| Management payment list at large dataset | PARTIAL | Functional filter/projection is verified; EXPLAIN/query-plan evidence remains a later DB gate. |

## 2. Architecture/design check

- `PaymentService` is a stable facade. `PaymentQueryService` owns projection and
  scope; `PaymentManualService` owns manual-payment validation, idempotency,
  Booking lock, Payment save, and Booking PAID/CONFIRMED mutation.
- The manual capability uses one TypeORM transaction and resolves duplicate
  idempotency keys after a unique-key race. Controllers only map HTTP headers,
  roles, and response envelopes.
- Customer and management projections are intentionally separate; the
  customer route cannot expose gateway/refund/creator fields.
- The pending VNPay check and Booking lock are preserved as a precondition for
  the VNPay collection/refund rounds. No route, DTO, enum, response, or schema
  changes were made in 8A.

Added `test/payment-manual-query-workflow.e2e-spec.ts` with fixture-scoped
cleanup under `E2eHarness`; the pending VNPay row is a direct database fixture
only to isolate the manual guard, while manual success/concurrency use real
HTTP routes.

## 3. Verification commands

| Command | Result |
|---|---|
| `npx jest --config ./test/jest-e2e.json --runInBand test/payment-manual-query-workflow.e2e-spec.ts` | PASS, 1 suite / 3 tests |
| `npm run test:e2e -- --runInBand` | PASS, 15 suites / 85 tests |
| `npm run test -- --runInBand` | PASS, 42 suites / 302 tests |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run openapi:validate` | PASS; snapshot current |
| `npm run data:audit` | PASS, 10/10 invariants with 0 violations |

## 4. Lượt 8A conclusion

Status: **PASS for query/manual-payment workflows and idempotent concurrency**.

Proceed to Lượt 8B (VNPay collection, Return/IPN, and expiration), carrying
the pending-attempt guard and WF-RISK-002 single-success candidate into the
callback matrix.
