# Bed configuration audit and design (Phases 1–2)

This document records the repository-backed audit required before introducing
the normalized `RoomType.beds[]` model. It is intentionally limited to the bed
configuration scope.

## Phase 1 — current usage

### Backend

The current legacy field is declared on
`src/module/room-type/schema/room-type.entity.ts` as nullable
`room_types.bed_type varchar(120)`. It is accepted and normalized as a free
text value by `RoomTypeService.create/update`, returned by the public and
admin RoomType response, and copied into the Room response projection by
`src/module/room/room-query.service.ts`.

The exact backend files found by the audit are:

- `src/module/room-type/schema/room-type.entity.ts`
- `src/module/room-type/dto/create-room-type.dto.ts`
- `src/module/room-type/dto/update-room-type.dto.ts`
- `src/module/room-type/dto/room-type-response.dto.ts`
- `src/module/room-type/room-type.service.ts`
- `src/module/room-type/room-type.service.spec.ts`
- `src/module/room/room-query.service.ts`
- `src/module/room/dto/room-response.dto.ts`
- `src/module/room/room.types.ts`
- `src/database/migrations/1784785000000-AddRoomTypeBedType.ts`
- `src/database/data-source.ts`
- `src/database/migration-contract.spec.ts`
- `test/room-type-workflow.e2e-spec.ts`
- `test/room-query-workflow.e2e-spec.ts`
- `src/module/room/room.service.spec.ts`
- `docs/openapi.json`

There is no `bedType` filter, search predicate, price calculation, or guest
capacity calculation. Room search filters by dates, guest capacity, price,
RoomType, and amenities; the bed text is only persisted and projected.

No production seed file contains a `bedType` value. Test fixtures use exact
legacy strings in `src/module/room-type/room-type.service.spec.ts`,
`src/module/room/room.service.spec.ts`, and the RoomType/room E2E payloads.

### Frontend

The current field is present in the generated contract as a required nullable
response property and as an optional nullable create/update property. The
feature files using it are:

- `src/features/room-types/schemas.ts`
- `src/features/room-types/types.ts` (through generated types)
- `src/features/room-types/components/RoomTypeForm.tsx`
- `src/features/rooms/components/SearchRoomCard.tsx`
- `src/features/home/components/FeaturedRoomsSection.tsx`
- `src/features/rooms/pages/PublicRoomDetailPage.test.tsx`
- `src/features/rooms/pages/ManagementRoomDetailPage.test.tsx`
- `src/features/rooms/pages/RoomSearchPage.test.tsx`
- `src/features/rooms/components/RoomImageManager.test.tsx`
- `src/features/home/pages/HomePage.test.tsx`
- `src/features/bookings/pages/CounterBookingPage.test.tsx`
- `src/features/bookings/components/CounterRoomPicker.test.tsx`
- `src/routes/RoomRouteAdapters.component.test.tsx`
- `src/api/generated/types.gen.ts`

`RoomCard` currently does not display the bed field. The form stores the value
as free text. No frontend code uses the value for filtering, pricing, or
capacity.

### Database evidence checked before implementation

The local `.env` points to database `hbms` (not a production database). A
read-only query returned two RoomType records (`id` 5 and 15); both have
`bed_type = NULL`. The existing column is nullable `varchar(120)`. No legacy
value required a migration in this local dataset, and no data was changed by
the audit.

## Phase 2 — selected design

- Add `BedType` values `SINGLE`, `DOUBLE`, `QUEEN`, `KING`, `BUNK`, and
  `SOFA_BED`.
- Add `room_type_beds` with one row per `(room_type_id, bed_type)`, positive
  integer quantity, a unique composite key, and a cascading foreign key to
  `room_types`.
- Use `varchar` plus application validation and database checks, matching the
  repository's preference for explicit SQL migrations instead of relying on a
  new MySQL enum.
- Add a non-soft-deleted `RoomType.beds` relation. The service will explicitly
  delete/reinsert child rows in a transaction when `beds` is supplied; deleting
  a RoomType cascades the child rows in the database.
- `beds` is the new source of truth. `bedType` remains nullable, read-only in
  meaning, and deprecated during the compatibility release. A request that
  sends both fields is rejected to avoid two competing write sources.
- Empty `beds: []` is allowed because the audited database already permits
  RoomTypes without a bed configuration. Missing `beds` in PATCH preserves the
  existing child rows.
- Legacy backfill uses an explicit parser for known Vietnamese/English bed
  phrases only. Unknown values remain in `room_types.bed_type` and are
  reported by the audit script; they are never deleted or guessed.

`bedType` will not be dropped in the compatibility implementation.
