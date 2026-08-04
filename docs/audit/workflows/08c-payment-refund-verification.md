# Lượt 8C - Refund và reconciliation

Date: 2026-08-01  
Scope: ADMIN-only manual/VNPay refund, idempotency, atomic Booking/calendar
side effects, provider timeout/reject/ambiguous results và reconciliation.

## 1. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| ADMIN-only refund | VERIFIED | Dedicated E2E: STAFF receives `403`; ADMIN can refund. Anonymous/customer authorization remains covered by the application E2E matrix. |
| Manual refund mutation | VERIFIED | Manual CASH payment becomes `REFUNDED`; Booking becomes `CANCELLED` + `REFUNDED`; reserved calendar rows are deleted in the same transaction. Repeated refund is idempotent by terminal state. |
| VNPay idempotency key | VERIFIED | Missing key returns `400`; same key is required for the VNPay path and replay does not send a second provider refund. |
| VNPay two-phase preparation | VERIFIED | Timeout leaves `REFUND_PENDING` with the request/idempotency metadata before the provider call; Booking remains paid while outcome is unknown. |
| Provider timeout/network error | VERIFIED | Timeout maps to `503`, logs only the payment identifier and keeps the pending state. The dedicated test uses a controlled gateway mock; real provider networking is external. |
| Verified refund success | VERIFIED / COVERED_BY_EXISTING | Dedicated and application E2E verify `REFUNDED`, Booking cancellation/payment status, and calendar release. |
| Verified refund still processing | VERIFIED / COVERED_BY_EXISTING | Existing application E2E covers response `00` + transaction status `05`, retaining `REFUND_PENDING`. |
| Explicit provider reject | VERIFIED | Direct VNPay reject restores `SUCCESS`; replay of the rejected idempotency key returns `409` without a second provider call. |
| Reconcile pending success | VERIFIED | Reconciliation calls `queryTransaction` only, applies a verified refund success, and never calls `refundFull` again. |
| Reconcile still pending / non-refund query | VERIFIED | A verified query for the original payment transaction keeps `REFUND_PENDING` and records a bounded diagnostic message. |
| Reconcile explicit reject | DEFECT_FIXED | Before the fix, a verified reject from `reconcile-refund` left the payment in `REFUND_PENDING`. The regression now proves it restores the exact `refundPreviousStatus` and retains provider evidence. |
| Unverified/malformed reconcile response | PARTIAL | The service preserves pending state and surfaces `503` for an unverified response; full provider malformed-response coverage remains in the gateway/unit matrix, not a live sandbox. |
| Concurrent refund/refund and refund/lifecycle | PARTIAL | Booking/payment pessimistic locks and lifecycle guards exist and are covered by unit/application tests; this slice does not claim a dedicated deterministic multi-request MySQL race for every pair. |
| Checked-in/checked-out/current state policy | VERIFIED / NEEDS_DECISION | Current code rejects manual/VNPay refund for CHECKED_IN/CHECKED_OUT bookings. Whether an ADMIN override is a product policy decision, not inferred here. |
| Manual refund idempotency header | NEEDS_DECISION | Manual refund currently does not require `Idempotency-Key`; terminal-state locking makes repeat calls harmless, while VNPay requires the key because an external mutation is possible. The plan wording requests an idempotency key for refund generally, so product clarification is still recorded rather than silently changing the contract. |
| Stale refund visibility / secret logging | VERIFIED / COVERED_BY_EXISTING | Management projection exposes stale-refund metadata; error logs include payment IDs and provider error text but no gateway secret/config value was observed in the exercised paths. |

## 2. Finding and fix

### Refund reconciliation reject did not restore the previous state

Finding: **DEFECT_FIXED** (P1 money/state). `applyVnPayReconciliation` handled
success, ambiguous and non-refund query results, but a verified explicit refund
reject (`transactionType=02`, non-success response) only saved provider fields.
The payment therefore remained `REFUND_PENDING`, even though no refund was
accepted and `refundPreviousStatus` was available.

Reproduction used a real MySQL fixture:

1. Payment was `SUCCESS` and changed to `REFUND_PENDING` with
   `refundPreviousStatus=SUCCESS`.
2. `reconcile-refund` received a verified VNPay reject (`91/91`, type `02`).
3. Before the fix, the HTTP response and database still reported
   `REFUND_PENDING`.

`src/module/payment/payment-refund.service.ts` now records transaction-02
evidence, leaves ambiguous/unverified responses pending, and for a verified
explicit reject restores `refundPreviousStatus` (`REQUIRES_REVIEW` remains
`REQUIRES_REVIEW`; all other valid previous states restore to `SUCCESS`). The
new E2E regression asserts the HTTP result, database status and provider
metadata.

## 3. Architecture/design check

- `PaymentService` remains a facade. `PaymentRefundService` owns refund state
  transitions, while `VnPayGatewayService` owns signing, HTTP transport and
  response verification.
- Preparation and application are separate TypeORM transactions. The external
  refund call is outside the DB transaction; verified results are applied under
  a Booking/payment pessimistic lock.
- Manual refunds do not call an external provider and are atomic with Booking
  cancellation and calendar release. VNPay refunds retain `REFUND_PENDING` or
  `REQUIRES_REVIEW` evidence rather than guessing a success.
- The reconciliation fix is local to the state transition and preserves route,
  DTO, enum and response-envelope contracts.

## 4. Verification commands

| Command | Result |
|---|---|
| `npx jest --config ./test/jest-e2e.json --runInBand test/payment-refund-workflow.e2e-spec.ts` | PASS, 1 suite / 4 tests |
| `npm run test:e2e -- --runInBand` | PASS, 17 suites / 91 tests |
| `npm run test -- --runInBand` | PASS, 42 suites / 302 tests |
| `npx jest src/module/payment --coverage --runInBand` | PASS, 5 suites / 36 tests; collection branch 53.02%, refund branch 56.47% |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run openapi:validate` | PASS; snapshot current |
| `npm run data:audit` | PASS, 10/10 invariants with 0 violations |

The plan's 70% branch target for refund critical logic is not met yet. Missing
branches are a testing gap to carry into the final payment/architecture gate;
the existing workflow matrix is not relabeled PASS merely because the overall
test command is green.

The `Simulated VNPay timeout` messages in E2E output are intentional provider
failure fixtures. They are expected logs from tests that pass.

## 5. Lượt 8C conclusion

Status: **PASS for the exercised local refund/reconciliation workflows;
reconciliation reject defect FIXED; branch target PARTIAL; manual-key policy
NEEDS_DECISION; provider sandbox BLOCKED_EXTERNAL.**

Proceed to Lượt 9 (Dashboard), carrying the refund timing/semantics decisions
and the critical payment branch-coverage gap into the final gates.
