# Lượt 8B - VNPay collection, Return/IPN và expiration

Date: 2026-08-01  
Scope: VNPay payment creation/callback verification, Return/IPN ordering,
replay/concurrency, late-success handling, expiration và single-success
invariant.

## 1. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| Create VNPay payment, ownership and enabled configuration | VERIFIED / COVERED_BY_EXISTING | Existing application E2E and payment unit suites cover owner scope, disabled gateway, stable reference/URL/deadline and pending-attempt guard. |
| Signature, TMN, amount, reference, transaction status/date | VERIFIED | Dedicated `test/payment-vnpay-workflow.e2e-spec.ts` uses a real locally generated signature; valid callback succeeds and tampered amount returns `97` without mutating Payment/Booking. |
| IPN before Return and Return before IPN | COVERED_BY_EXISTING | Existing application E2E callback matrix covers both orderings and the response-code contract. |
| Repeated IPN/Return | VERIFIED / COVERED_BY_EXISTING | Dedicated suite verifies repeated valid IPN returns `02`; existing Return tests cover replay/idempotent behavior. |
| Provider failed response and malformed/unverified callback | VERIFIED / COVERED_BY_EXISTING | Existing Payment unit/E2E matrix covers failed provider status, malformed payload and verification rejection. |
| Pending payment expiration and repeated scheduler | COVERED_BY_EXISTING | Existing application E2E and expiration unit tests cover expiry and repeat execution. |
| Cancelled Booking late success | VERIFIED | A valid late success for a cancelled Booking is persisted as `REQUIRES_REVIEW`, not `SUCCESS`; Booking remains cancelled. |
| WF-RISK-002: expired attempt A, another SUCCESS, then A late success | DEFECT_FIXED | Before the fix, the signed late callback changed A to `SUCCESS`, producing two successful payments for one Booking. After the fix, A becomes `REQUIRES_REVIEW` and the database retains exactly one `SUCCESS`. |
| Unique gateway transaction collision / same transaction across references | PARTIAL | Existing unique-field and gateway unit coverage is present; no separate deterministic MySQL race proving every collision branch was added in this slice. |
| Controlled VNPay sandbox | BLOCKED_EXTERNAL | The repository has no provider sandbox credential/response channel. Local signed callbacks prove the adapter and application contract only; they are not external-provider evidence. |

## 2. Finding and fix

### WF-RISK-002 - late callback could create a second successful payment

Label before fix: `CANDIDATE_DEFECT` (P1 money). The callback path checked
the Booking cancellation state but did not check whether another Payment for
the same Booking was already `SUCCESS`. Because the database invariant is
implemented by audit code rather than a unique `(booking_id, SUCCESS)` index,
the following real MySQL sequence reproduced two successful rows:

1. Payment A was `FAILED`/`EXPIRED`.
2. Payment B was already `SUCCESS` for the same Booking.
3. A valid signed success callback for A was submitted.

The fix is in `src/module/payment/payment-collection.service.ts`. Inside the
same TypeORM transaction, a successful callback now checks for a different
`SUCCESS` Payment for the locked Booking. When one exists (or the Booking is
cancelled), the callback stores gateway evidence and moves the attempted
Payment to `REQUIRES_REVIEW`; it cannot create a second `SUCCESS`.

The dedicated regression test keeps the exact precondition and asserts both
the response and the database invariant. Existing cancelled-late-success
behavior remains unchanged.

## 3. Architecture/design check

- `PaymentService` remains a facade; collection/callback rules stay in
  `PaymentCollectionService`, while gateway signing/transport remains in the
  VNPay gateway service.
- Callback verification and state mutation execute under the existing
  TypeORM transaction/Booking lock. The new check is adjacent to the status
  transition and does not move HTTP concerns into the service.
- `REQUIRES_REVIEW` is used as the explicit reconciliation state for an
  ambiguous/unsafe late success; no route, DTO, enum or database column was
  changed in this round.
- The local suite proves application-level idempotency and replay handling.
  Provider sandbox, network timeout and provider-side transaction semantics
  remain external evidence and are intentionally not marked PASS.

## 4. Coverage and verification commands

Payment module unit coverage after the fix:

| Service | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `payment-collection.service.ts` | 74.15% | 53.02% | 78.94% | 73.86% |
| `payment-refund.service.ts` | 74.68% | 56.47% | 93.54% | 74.47% |

The plan's 70% branch target is not yet met for either critical payment
capability; the missing branches are carried into Lượt 8C and final closure.

| Command | Result |
|---|---|
| `npx jest --config ./test/jest-e2e.json --runInBand test/payment-vnpay-workflow.e2e-spec.ts` | PASS, 1 suite / 3 tests |
| `npx jest src/module/payment --runInBand` | PASS, 5 suites / 36 tests |
| `npm run test:e2e -- --runInBand` | PASS, 16 suites / 88 tests |
| `npm run test -- --runInBand` | PASS, 42 suites / 302 tests |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run openapi:validate` | PASS; snapshot current |
| `npm run data:audit` | PASS, 10/10 invariants with 0 violations |

The expected `Simulated VNPay timeout` log is produced by the pre-existing
refund E2E fixture; it is an intentional test failure path, not a failed test.

## 5. Lượt 8B conclusion

Status: **PASS for local VNPay adapter/callback workflows; WF-RISK-002
FIXED; external sandbox BLOCKED_EXTERNAL; payment branch target remains
PARTIAL.**

Proceed to Lượt 8C (refund and reconciliation), preserving the single-success
guard and the `REQUIRES_REVIEW` reconciliation state.
