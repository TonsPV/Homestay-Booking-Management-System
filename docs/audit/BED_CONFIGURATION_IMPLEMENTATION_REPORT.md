# Bed configuration implementation report

Date: 2026-08-05

Scope: the repository-backed implementation from
`MODULE_BY_MODULE_AUDIT_AND_IMPROVEMENT_PLAN.md` / the attached 13-phase
bed-configuration plan, across:

- `D:\HBMS\homestay-booking-management-system-api`
- `D:\HBMS\homestay-booking-management-system-fe`

The implementation is additive. The legacy `room_types.bed_type` column has
not been dropped, renamed, or overwritten by a guessed value.

## Result

The normalized model is implemented end to end:

```text
RoomType.beds[] = { type, quantity }
type = SINGLE | DOUBLE | QUEEN | KING | BUNK | SOFA_BED
```

`beds` is now the write source of truth. `bedType` remains a deprecated
compatibility field. Sending both fields in one request returns `400`; omitting
`beds` from a PATCH preserves existing child rows; sending `beds: []` clears
the configuration intentionally.

## Backend changes

- Added the `BedType` enum, stable ordering, strict quantity limits, and an
  explicit legacy parser in
  [`bed-configuration.ts`](D:/HBMS/homestay-booking-management-system-api/src/module/room-type/bed-configuration.ts).
- Added `RoomTypeBed` and the `room_type_beds` table with:
  - one row per `(room_type_id, bed_type)`;
  - positive quantity check;
  - enum-value check;
  - unique composite key;
  - `ON DELETE CASCADE` foreign key.
- Added migration
  [`1784786000000-CreateRoomTypeBeds.ts`](D:/HBMS/homestay-booking-management-system-api/src/database/migrations/1784786000000-CreateRoomTypeBeds.ts).
  It is additive, keeps `bed_type`, parses only known Vietnamese/English
  phrases, and leaves unknown legacy text untouched.
- Updated RoomType create/update service flows to validate, normalize, and
  replace child rows inside TypeORM transactions. Public/admin RoomType and
  Room projections now include `beds`.
- Updated DTOs and regenerated
  [`docs/openapi.json`](D:/HBMS/homestay-booking-management-system-api/docs/openapi.json).
  The legacy field is marked deprecated; normalized request/response schemas
  are documented.
- Added unit and E2E coverage for ordering, invalid values, duplicate types,
  mixed legacy/new requests, PATCH preserve/replace behavior, public room
  projections, and amenity separation.
- Added the explicit data audit/backfill commands:
  - `npm run room-type-beds:audit` — dry-run only;
  - `npm run room-type-beds:backfill` — explicit `--apply`, with a production
    database guard.

## Frontend changes

- Regenerated the FE client from the backend OpenAPI contract.
- Replaced the free-text RoomType form field with a validated dynamic bed-row
  editor (maximum six types, no duplicate type, quantity 1–20).
- Added the shared formatter
  [`bed-configuration.ts`](D:/HBMS/homestay-booking-management-system-fe/src/shared/formatting/bed-configuration.ts)
  and used it in management lists, room cards, search cards, featured rooms,
  and public room detail.
- Kept a visible legacy warning when an old record has no normalized beds;
  the FE does not silently reinterpret or overwrite that value.
- Updated fixtures and added formatter tests.

## Local data and migration evidence

The audit was run against the local `.env` database `hbms`; no production
database was used.

Latest `room-type-beds:audit` result:

```json
{
  "mode": "dry-run",
  "totalRoomTypes": 2,
  "legacyBedTypeNull": 2,
  "parseableLegacy": 0,
  "roomTypesWithBeds": 0,
  "pendingBackfill": 0,
  "appliedRows": 0,
  "unparseable": []
}
```

The explicit apply command was also executed locally and reported
`"mode": "apply"` with `appliedRows: 0`; there was no pending legacy data to
change. `npm run schema:check` reported: `Database schema matches entity
metadata.`

No production migration or production backfill was run.

## Verification results

### Backend

| Check | Result |
| --- | --- |
| `npm test -- --runInBand` | PASS — 50 suites, 374 tests |
| `npm run test:e2e -- --runInBand` | PASS — 22 suites, 105 tests |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run openapi:validate` | PASS — 5 contract tests |
| `npm run migration:show` | PASS — new migration applied locally |
| `npm run schema:check` | PASS |
| `npm run room-type-beds:audit` | PASS — dry-run, no pending rows |
| `npm run room-type-beds:backfill` | PASS — explicit apply, 0 rows changed |

The repository-wide `npm run data:audit` also ran. It found 0 violations in
all checks except the existing local `stale-refund` check, which reported 3
old `REFUND_PENDING` rows older than seven days. That issue is outside this
bed-configuration change and was not altered implicitly.

### Frontend

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS — 81 files, 335 tests |
| `npm run build` | PASS |
| `npm run test:e2e` | PASS — 76 passed, 2 skipped |
| `npm run architecture:check` | PASS — no unreachable module, cycle, undeclared import, or tracked artifact |
| `npm run contract:check` | PASS |
| `npm run contract:test` | PASS |

## Architecture/design review

The change follows the existing architecture: RoomType owns the bed business
rules; Room/RoomQuery only projects the relation; controllers remain HTTP
mappers; FE display uses one shared formatter; persistence replacement is
transactional. The migration and OpenAPI files are generated/registered by
the existing project mechanisms rather than manually edited contracts.

No Amenity field was reused for beds, no route was renamed, and no unrelated
booking/payment behavior was changed. The new table is intentionally not
soft-deleted because a RoomType update replaces its complete child
configuration atomically.

The compatibility phase is **still active**. Do not drop `bedType` yet:
existing clients and legacy records can still depend on it, and the FE keeps a
fallback display/warning. A later release may remove it only after a separate
consumer audit, production dry-run, and deprecation window.

The only unrelated repository change present before this work was the user's
existing `.env.example` modification; it was preserved. The new audit doc,
migration, parser, tests, generated contracts, and FE formatter are all scoped
artifacts, not file-rác.
