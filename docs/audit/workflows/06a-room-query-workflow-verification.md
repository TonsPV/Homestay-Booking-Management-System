# Lượt 6A - Room catalog/query workflow verification

Date: 2026-08-01  
Scope: public catalog, management inventory projection, date/guest/price/
RoomType/Amenity search, calendar exclusion, and query validation.

## 1. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| Public catalog visibility | VERIFIED | READY and OCCUPIED catalog rows are visible; HIDDEN and MAINTENANCE are excluded. |
| Public projection | VERIFIED | Public rows omit `roomNumber` and operational `status`. |
| Management projection | VERIFIED | ADMIN management list (explicit `limit=100` in the isolated suite) includes operational room number/status and hidden/maintenance inventory. |
| Date range validation | VERIFIED | Invalid/reversed dates return `400`; end date is treated as exclusive in the SQL predicate. |
| Guest capacity | VERIFIED | Search applies `roomType.maxGuests >= guests`. |
| Price and RoomType filters | VERIFIED | Search with min/max price and RoomType returns the matching physical room. |
| All-selected Amenity filter | VERIFIED | Search requiring both selected active Amenity IDs returns the matching RoomType and excludes a blocked room. |
| Calendar exclusion | VERIFIED | A real BLOCKED calendar night removes the room from the overlapping stay search. |
| Query ID/pagination validation | VERIFIED | Invalid RoomType ID and page `0` return `400`. |
| EXPLAIN/N+1 dataset gate | NOT_RUN | Requires a documented dataset and database plan capture; not marked green from API assertions alone. |

## 2. Commands

| Command | Result |
|---|---|
| `npx jest --config ./test/jest-e2e.json --runInBand test/room-query-workflow.e2e-spec.ts` | PASS, 1 suite / 3 tests |
| `npm run test:e2e -- --runInBand` | PASS, 9 suites / 63 tests |
| `npm run lint` | PASS |

No Room query production change was required in this slice. The standalone suite
owns room, RoomType, Amenity, and calendar fixtures and removes them through the
shared safe harness.

## 3. Architecture/design check

- `RoomService` delegates query capability to `RoomQueryService`; controllers do
  not build SQL or decide visibility.
- Public and management query builders are separate, with explicit operational
  field projection boundaries.
- Calendar exclusion uses a `NOT EXISTS` predicate over the date interval and is
  consistent with the date-range semantics tested here.
- EXPLAIN/query-count and future bookability semantics for OCCUPIED/CLEANING are
  still dataset/product-policy work, not inferred defects.

## 4. Lượt 6A conclusion

Status: **PASS for API/query workflows; PARTIAL for database-plan evidence**.

Proceed to Lượt 6B (Room mutations/state/image lifecycle), carrying the already
observed flaky concurrent room-cover test for deterministic characterization.
