# Lượt 4 - Amenity workflow verification

Date: 2026-08-01  
Scope: public/admin Amenity routes, soft-delete/restore state, name uniqueness,
RoomType assignment protection, and admin response projection.

## 1. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| Public list/detail | VERIFIED | Active amenities are readable publicly; deleted detail returns `404`. |
| Public projection | VERIFIED | Public payload omits `deletedAt`. |
| ADMIN/STAFF/customer authorization | VERIFIED | Admin mutations work; STAFF and customer mutation/list attempts return `403`. |
| Create normalization | VERIFIED | Name/description trimming and nullable description are persisted as expected. |
| Admin search/pagination | VERIFIED | Search and page/limit metadata are checked against MySQL. |
| Active/soft-deleted uniqueness | VERIFIED | Duplicate active names and names held by deleted rows return `409`. |
| Empty update | VERIFIED | Empty admin update returns `400`. |
| Soft-delete | VERIFIED | Unassigned amenity is soft-deleted, hidden publicly, and visible to admin detail/includeDeleted. |
| Restore | VERIFIED | Deleted amenity restores; restoring an already active amenity returns `400`. |
| RoomType assignment protection | VERIFIED | An amenity linked through `room_type_amenities` cannot be deleted (`409`); after relation removal, deletion succeeds. |
| Duplicate-key create race | VERIFIED | Two concurrent creates return one `201` and one `409`; exactly one row remains. |

## 2. Commands

| Command | Result |
|---|---|
| `npx jest --config ./test/jest-e2e.json --runInBand test/amenity-workflow.e2e-spec.ts` | PASS, 1 suite / 3 tests |
| `npm run test:e2e -- --runInBand` | PASS, 7 suites / 57 tests |
| `npm run lint` | PASS |

No Amenity production code required a change in this round. The existing unit
suite covers normalization, soft-delete/restore errors, assigned-relationship
guard, and invalid IDs; the standalone MySQL suite adds route authorization,
real projections, and the duplicate race.

## 3. Architecture and design-pattern check

- Public and admin visibility are split into separate controllers and response
  projections; this matches the repository rule for actor visibility.
- `AmenityService` owns normalization, uniqueness, and state transitions while
  controllers only map HTTP/envelope concerns.
- Existing `AccessTokenGuard`, `RolesGuard`, and `@Roles('ADMIN')` are reused.
- The RoomType join-table check is enforced by a service query before soft-delete;
  no cascade or hidden hard delete was introduced.
- No safe deletion target or duplicate Amenity file was proven.

## 4. Remaining characterization

Concurrent update/restore/delete ordering beyond duplicate create is not yet a
deterministic contract in the repository. It is carried to the RoomType/DB
relationship round rather than inventing a new lock policy here.

## 5. Lượt 4 conclusion

Status: **PASS**. Amenity public/admin workflows, soft-delete lifecycle,
relationship protection, authorization, projection, and create race have direct
unit and standalone MySQL evidence.
