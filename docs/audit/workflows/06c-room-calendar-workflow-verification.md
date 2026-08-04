# Lượt 6C - Room calendar workflow verification

Date: 2026-08-01  
Scope: calendar listing, date enumeration, BLOCKED/RESERVED ownership,
unblock behavior, range limits, Room locking, and booking/block concurrency.

## 1. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| Calendar list and end-date exclusivity | VERIFIED | Dedicated MySQL E2E returns one row per night for `[from,to)` and lists exactly the three requested nights. |
| Block range and reason normalization | VERIFIED | STAFF block creates one BLOCKED row per enumerated night and trims the reason. |
| Maximum range 366 days | VERIFIED | A range larger than 366 days returns `400`; no mutation is committed. |
| Duplicate/overlap block | VERIFIED | Duplicate room-date insert maps to `409`; existing rows remain intact. |
| Missing Room | VERIFIED | Block against a missing Room returns `404`. |
| Unblock only BLOCKED entries | VERIFIED | Unblock removes BLOCKED rows and leaves RESERVED rows untouched (`removedCount: 0` for reserved-only range). |
| RESERVED ownership | VERIFIED | A valid RESERVED row keeps `booking_id`; direct invalid `RESERVED + NULL booking_id` insert is rejected by the database check constraint. |
| Two concurrent blocks | VERIFIED | Same Room/date range yields exactly `[201,409]` and exactly two BLOCKED nights, proving Room-row serialization plus unique room/date protection. |
| Concurrent block vs online booking | VERIFIED | A booking and a block for the same Room/date range yield exactly `[201,409]`; the winning operation owns both calendar nights. |
| Past-date block policy | NEEDS_DECISION | Current service accepts a past date (`2020-01-01` → `2020-01-02`). The plan lists this as a product decision; no rejection was invented. |
| Transaction rollback | VERIFIED | Duplicate/overlap and block-vs-booking conflicts leave only the pre-existing/committed rows; no partial night set is observed. |

## 2. Implementation/design check

- `RoomAvailabilityService` owns calendar business rules; the management
  controller only maps HTTP requests and role guards.
- `block` and `unblock` both use a TypeORM transaction and a pessimistic Room
  lock. `block` inserts all nights as one transaction, so a duplicate/overlap
  failure rolls back the complete range.
- The `(room_id, stay_date)` unique index and
  `chk_room_calendar_status_ownership` database check complement the service
  checks. The E2E suite verifies both behavior and the DB constraint.
- `unblock` filters `status = BLOCKED`, so it cannot release a reservation.
- No route, response shape, enum, or migration was changed in this slice.

Added `test/room-calendar-workflow.e2e-spec.ts` with isolated fixtures under
`E2eHarness`. The suite includes a direct reserved fixture only to verify the
database ownership constraint; online booking concurrency uses the real Booking
HTTP flow.

## 3. Verification commands

| Command | Result |
|---|---|
| `npx jest --config ./test/jest-e2e.json --runInBand test/room-calendar-workflow.e2e-spec.ts` | PASS, 1 suite / 3 tests |
| `npm run test:e2e -- --runInBand` | PASS, 11 suites / 71 tests |
| `npm run lint` | PASS for the slice; full lint to be rerun at the next gate |

The full E2E output retains the deliberate `Simulated VNPay timeout` log from
the existing refund-failure fixture; all suites passed.

## 4. Lượt 6C conclusion

Status: **PASS for calendar API, persistence, ownership, rollback, and
concurrency; NEEDS_DECISION for past-date blocking**.

Proceed to Lượt 6D (Room image and storage), carrying the same E2E safety and
single-worker constraints forward.
