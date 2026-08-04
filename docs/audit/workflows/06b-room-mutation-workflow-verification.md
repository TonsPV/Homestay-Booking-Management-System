# Lượt 6B - Room mutation/state workflow verification

Date: 2026-08-01  
Scope: Room CRUD, mutation authorization, room-number uniqueness, history-protected
hard delete, status transitions, stale writes, Booking occupancy ownership, and
managed-image cleanup.

## 1. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| ADMIN create/update/delete boundary | VERIFIED | Dedicated MySQL E2E; STAFF create/update returns `403`, ADMIN CRUD succeeds. |
| Room number uniqueness including a soft-deleted row | VERIFIED | Soft-deleted Room row remains protected by `ensureRoomNumberIsAvailable(...).withDeleted()` and a recreate returns `409`. |
| Hard delete without history | VERIFIED | History-free Room with a managed image is removed successfully. |
| Hard delete with Calendar history | VERIFIED | A BLOCKED calendar row causes Room delete to return `409`. |
| Managed image cleanup after Room delete | VERIFIED | The response succeeds and the previously stored `/media/room-images/...webp` returns `404`. |
| ADMIN/STAFF status matrix | VERIFIED | All 25 current/next `RoomStatus` pairs exercised. ADMIN receives `200`; STAFF receives `403` when current or next status is `HIDDEN`, otherwise `200`. |
| Idempotent status request | VERIFIED | Same-status transitions remain successful under the same role matrix and conditional update. |
| Stale general update vs ADMIN HIDDEN transition | DEFECT_FIXED | Deterministic barrier reproduced final `READY` before the fix; field-only conditional update now preserves final `HIDDEN`. |
| WF-RISK-001: CHECKED_IN ↔ OCCUPIED | CANDIDATE_DEFECT / NEEDS_DECISION | With a real `CHECKED_IN` Booking and Room `OCCUPIED`, Room status API accepted ADMIN `OCCUPIED → READY`; Booking stayed `CHECKED_IN`, producing the data-audit invariant violation. The plan explicitly defers state-policy change until Room/Booking ownership is decided. |
| RoomType delete/update race | PARTIAL | Sequential RoomType/Room preconditions are covered by earlier RoomType and Room tests; no deterministic MySQL barrier was added in this slice, so no race claim is made. |

## 2. Changes applied

`src/module/room/room-mutation.service.ts` no longer calls `save(room)` for a
general Room update. It validates the snapshot, constructs only the requested
fields, and executes:

```ts
repository.update({ id, deletedAt: IsNull() }, changes)
```

The affected-row check maps a concurrent delete/state loss to `409`. Because
`status` is not part of `changes`, an old general-update snapshot cannot write a
stale Room status over a concurrent status mutation. Duplicate room numbers are
still translated through the existing MySQL duplicate-key envelope.

Added `test/room-mutation-workflow.e2e-spec.ts`, which owns its Room, RoomType,
Calendar, Booking, image, Customer, and User fixtures under `E2eHarness`.

## 3. Verification commands

| Command | Result |
|---|---|
| `npx jest --config ./test/jest-e2e.json --runInBand test/room-mutation-workflow.e2e-spec.ts` | PASS, 1 suite / 5 tests |
| `npx jest --runInBand src/module/room/room.service.spec.ts` | PASS, 1 suite / 13 tests |
| `npm run test:e2e -- --runInBand` | PASS, 10 suites / 68 tests |
| `npm run test -- --runInBand` | PASS, 42 suites / 302 tests |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run openapi:validate` | PASS; snapshot current, 4 contract tests |
| `git diff --check` | PASS; only normal Git LF/CRLF warnings were printed |

The full E2E output still contains the deliberate `Simulated VNPay timeout`
log from the existing refund-failure fixture; the suite passed and this is not
a Room failure.

## 4. Architecture/design check

- `RoomController` remains an HTTP mapper; mutation rules remain in
  `RoomMutationService` and query projection remains in `RoomQueryService`.
- Public and management routes keep separate visibility and role boundaries.
- Room deletion is intentionally hard-delete only when no Booking/Calendar
  history exists; image storage cleanup runs after the transaction.
- The stale-write fix is a minimal capability-local change and preserves route,
  response, enum, and schema contracts.
- The Room service split (facade/query/mutation/availability/image) is aligned
  with the current capability boundaries. The remaining architecture concern is
  cross-module ownership of Room status transitions, not a reason to merge the
  services back together.

## 5. Lượt 6B conclusion

Status: **PASS for Room mutation and storage workflows after one defect fix;
PARTIAL for cross-module state ownership**.

Confirmed follow-up before changing state policy: decide whether Booking owns
the `CHECKED_IN ↔ OCCUPIED` invariant and then either reject direct Room
transitions that conflict with a checked-in Booking or move the state mutation
behind a single transactional capability. Until that decision, the finding is
kept as evidence rather than silently changing ADMIN/STAFF behavior.

Proceed to Lượt 6C (Room calendar), carrying the occupancy finding forward.
