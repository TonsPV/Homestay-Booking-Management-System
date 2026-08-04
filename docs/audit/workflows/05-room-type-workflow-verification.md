# Lượt 5 - RoomType workflow verification

Date: 2026-08-01  
Scope: public/admin RoomType visibility, base fields, Amenity set semantics,
soft-delete/restore, and active Room protection.

## 1. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| Public/admin list/detail projections | VERIFIED | Public detail omits `deletedAt`; admin detail includes it. |
| Create/update base fields | VERIFIED | Name/nullable description, decimal `basePrice`, and `maxGuests` are persisted; empty update is `400`. |
| `maxGuests` boundaries | VERIFIED | `0` and `101` are rejected (`1..100` policy). |
| Exact Amenity set | VERIFIED | Two active Amenity IDs are assigned and returned sorted by name. |
| Duplicate/missing Amenity IDs | VERIFIED | Duplicate IDs and missing IDs return `400`; empty set is accepted and clears the relation. |
| Active Room deletion guard | VERIFIED | RoomType with an active Room returns `409`; after the Room is soft-deleted, RoomType soft-delete succeeds. |
| RoomType restore | VERIFIED | Public detail becomes `404` after deletion, restore succeeds, and restoring active state returns `400`. |

## 2. Commands

| Command | Result |
|---|---|
| `npx jest --config ./test/jest-e2e.json --runInBand test/room-type-workflow.e2e-spec.ts` | PASS, 1 suite / 3 tests |
| `npm run test:e2e -- --runInBand` | PASS, 8 suites / 60 tests |
| `npm run lint` | PASS |

The existing RoomType unit suite additionally covers name uniqueness including
deleted rows, relationship validation, and service-level state transitions. No
RoomType production change was required in this characterization round.

## 3. Architecture/design check and remaining gaps

- Public/admin controllers are separated by actor visibility and use the existing
  AccessToken/Roles guard pattern.
- `RoomTypeService.setAmenities()` already owns a transaction and pessimistic lock;
  the E2E set test verifies its external invariant.
- The plan's EXPLAIN/query-count dataset gate and concurrent `setAmenities` versus
  Amenity delete are not yet run; they remain explicit database/relationship work,
  not silently marked VERIFIED.
- No safe junk file or duplicate RoomType implementation was proven.

## 4. Lượt 5 conclusion

Status: **PASS for the characterized RoomType workflows; PARTIAL for query-plan and
cross-module concurrency gates**. Continue with Room catalog/query (Lượt 6A) and
carry the relationship concurrency checks forward.
