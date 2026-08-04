# Lượt 12 - Cross-module journey verification

Date: 2026-08-01  
Scope: API-to-database journeys crossing Auth, Catalog, Booking, Calendar,
Room, Payment, Refund, Image and Dashboard boundaries.

## 1. Journey matrix

| Journey | Evidence | Status / finding |
|---|---|---|
| Public catalog → customer register/login → online Booking → VNPay create → IPN/Return → check-in/out | Existing `test/app.e2e-spec.ts` sequence plus Auth/Room/Booking/VNPay dedicated suites; final full E2E is green and data audit is clean | VERIFIED across the current API flows. A single standalone test does not own the entire browser-style journey, so frontend orchestration remains outside this backend gate. |
| ADMIN creates STAFF → STAFF counter Booking + passwordless Customer → initial password → Customer login/Booking visibility | Existing application E2E (`issues STAFF accounts...`, `allows staff to create and manage a counter booking`) plus Customer workflow suite | VERIFIED for API state/authorization; passwordless initial-password one-time behavior is covered in the Customer slice. |
| Online unpaid → expiry → calendar release → late callback | Existing application E2E and Booking/Payment expiration unit suites; VNPay dedicated suite verifies late callback review behavior | VERIFIED for expiration/release and callback state. |
| Attempt A expires → manual/attempt B succeeds → callback A late | Dedicated VNPay E2E reproduces WF-RISK-002 and asserts exactly one SUCCESS; `data:audit` confirms the invariant after the full run | VERIFIED; WF-RISK-002 FIXED in `PaymentCollectionService`. |
| Paid Booking → refund timeout → reconciliation → Booking/calendar state | Dedicated refund E2E + existing application refund matrix; full run and data audit pass | VERIFIED; reconciliation reject regression FIXED; timeout remains `REFUND_PENDING` until verified. |
| CHECKED_IN Booking concurrently with Room status mutation | Dedicated Room mutation E2E reproduces a real invariant violation when the direct status API changes a checked-in room; no policy fix was applied | CANDIDATE_DEFECT / NEEDS_DECISION (WF-RISK-001). The owner of the Room↔Booking state machine must be decided before enforcing a transition policy. |
| RoomType/Amenity mutation concurrently with Room/Booking creation | RoomType/Amenity workflows and FK/audit checks pass; no deterministic multi-request race covering every mutation pair exists | PARTIAL. Database FK protection is verified; full race matrix remains a final testing gap. |
| Customer/User lock or password reset during an in-flight request | User and Customer dedicated workflows reproduce/fix stale update/token-version races; old tokens are rejected | VERIFIED for exercised races; multi-replica authorization storage is outside local scope. |
| Room image DB/filesystem failure and cleanup/reconciliation | Room Image workflow covers malformed/missing upload boundaries, concurrent cover/first-image and managed storage behavior | VERIFIED for exercised cleanup/boundaries; external filesystem failure injection/reconciliation policy remains PARTIAL. |
| Dashboard before/after payment/refund/inventory change | Dashboard E2E compares baseline/after deltas for collected/refunded/review/pending, room status and calendar occupancy | VERIFIED for current SQL semantics; gross/net, historical inventory and capacity denominator remain NEEDS_DECISION. |

## 2. Cross-journey invariants checked after the run

The final MySQL test run was followed by the read-only data audit:

- active Booking ↔ one RESERVED calendar row per booked night;
- cancelled Booking has no RESERVED calendar rows;
- at most one SUCCESS Payment per Booking;
- Booking payment status agrees with successful/refunded payments;
- OCCUPIED rooms and CHECKED_IN Bookings agree in both directions;
- exactly one cover image per room with images;
- no orphan RoomType/Amenity join rows;
- expired Booking/Payment state is not left pending;
- stale refunds remain visible for reconciliation.

All 10 checks returned 0 violations.

## 3. Architecture/design check

- Cross-module mutation ownership is mostly explicit: Booking owns calendar
  reservation/lifecycle, Payment owns payment/refund transitions, and Room owns
  catalog/status/image operations. WF-RISK-001 shows that the direct Room
  status endpoint still crosses a Booking-owned occupancy invariant without a
  shared coordinator/policy.
- The two money defects found in the journey audit were fixed at the state
  transition owner rather than patched in tests or controllers.
- The E2E suite now uses the shared safety harness and serial execution; each
  dedicated module suite uses fixture-scoped cleanup, so green results are not
  dependent on a clean destructive reset.

## 4. Verification commands

| Command | Result |
|---|---|
| `npm run test:e2e -- --runInBand` | PASS, 20 suites / 98 tests |
| `$env:NODE_ENV='test'; npm run data:audit` | PASS, 10/10 invariants, 0 violations |
| `npm run test -- --runInBand` | PASS, 42 suites / 302 tests |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run openapi:validate` | PASS; snapshot current |

The expected provider-timeout log lines are intentional failure-path fixtures;
the corresponding tests pass and no secret is printed.

## 5. Lượt 12 conclusion

Status: **PASS for the exercised cross-module API/database journeys and all
10 post-journey invariants; WF-RISK-001, Room/Amenity race completeness,
filesystem reconciliation, and Dashboard semantic decisions remain open and
must be carried into Lượt 13 rather than hidden by aggregate green tests.**
