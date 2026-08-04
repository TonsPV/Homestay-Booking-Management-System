# Lượt 6D - Room image and storage workflow verification

Date: 2026-08-01  
Scope: multipart boundary validation, decoded-image validation, WebP storage,
cover state, concurrent image mutations, DB/file cleanup, external URLs, and
storage topology.

## 1. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| Missing file | DEFECT_FIXED | A multipart request with no file/body previously threw `TypeError` and returned `500`; the service now normalizes `body ?? {}` and returns the documented `400` missing-file error. |
| MIME vs decoded bytes | VERIFIED | PNG bytes declared as JPEG return `400`; decoded malformed bytes return `400`. |
| Size/format/orientation processing | VERIFIED | Storage unit suite verifies valid large PNG becomes managed WebP and is resized to the configured max edge; Sharp metadata validation rejects invalid/inconsistent uploads. |
| Managed path and static serving | VERIFIED | E2E response is `/media/room-images/{roomId}/{uuid}.webp`; static GET returns `image/webp` and `nosniff`. |
| First image cover | VERIFIED | First successful image is automatically `isCover=true`; a second default image is not cover. |
| Exactly one cover under concurrency | VERIFIED | Two concurrent first uploads both succeed and leave exactly one cover; concurrent set-cover requests both return `200` and leave exactly one cover. |
| Delete-cover fallback | VERIFIED | Deleting the current cover promotes the remaining image and removes the managed file (`GET` returns `404`). |
| Role boundary | VERIFIED | STAFF upload/delete attempts return `403`; ADMIN owns image mutations. |
| External URL | VERIFIED | Deleting an external `https://...` image removes only its DB row; storage deletion is a no-op for non-managed URLs. |
| DB save/commit failure cleanup | VERIFIED | Existing unit test forces save failure, checks rollback/release, and verifies the newly stored managed URL is deleted. |
| Filesystem delete failure / orphan reconciliation | PARTIAL | `deleteManaged` logs non-ENOENT failures and does not fail the DB mutation; no orphan scan/reconciliation job exists in this slice, so operational policy remains open. |
| Multi-replica storage | NEEDS_DECISION | Code uses a local managed directory. It is verified only for a single instance or a persistent shared volume; object/shared storage is required for independent replicas. |

## 2. Changes applied

`src/module/room/room-image.service.ts` now accepts an absent multipart body
and normalizes it before reading optional fields. This preserves the existing
DTO validation and converts the missing-file boundary from an internal `500`
to the intended `400` response.

Added `test/room-image-workflow.e2e-spec.ts` with isolated Room/RoomType/User
fixtures and storage cleanup registered through `E2eHarness`. Existing storage
and service unit tests remain unchanged and continue to cover rollback and
external URL handling.

## 3. Verification commands

| Command | Result |
|---|---|
| `npx jest --runInBand src/module/room/room-image.service.spec.ts src/module/room/room-image-storage.service.spec.ts` | PASS, 2 suites / 8 tests |
| `npx jest --config ./test/jest-e2e.json --runInBand test/room-image-workflow.e2e-spec.ts` | PASS, 1 suite / 3 tests |
| `npx jest --config ./test/jest-e2e.json --runInBand test/room-calendar-workflow.e2e-spec.ts` | PASS, 1 suite / 3 tests |

The full E2E gate is rerun after this slice before closing the Room capability
round. The deliberate VNPay timeout log in the application suite is unrelated
to Room image behavior.

## 4. Architecture/design check

- `RoomImageService` owns DB transaction, Room lock, cover transition, and
  rollback cleanup; `RoomImageStorageService` owns image decoding and managed
  filesystem operations.
- The controller remains an HTTP/guard adapter and does not make cover or
  storage decisions.
- The one-cover invariant is currently application-lock based. A future
  database partial-unique strategy or object storage migration must preserve
  this behavior across replicas; it is not inferred from this single-instance
  test.

## 5. Lượt 6D conclusion

Status: **PASS after one HTTP-boundary defect fix; PARTIAL for filesystem
reconciliation and multi-replica storage policy**.

The Room capability rounds (6A–6D) now have dedicated workflow evidence. Carry
the confirmed cross-module occupancy finding and the two storage decisions into
the Booking/Payment and architecture rounds rather than silently changing
contracts.
