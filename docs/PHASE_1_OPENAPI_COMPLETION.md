# Phase 1: OpenAPI Response Contract - Backend Status

Date: 2026-07-29

Status: Backend complete; frontend contract migration remains outside this
repository.

## Completed backend work

- Added reusable success, pagination, and error envelope schemas.
- Added response DTOs that match the actual service response fields for Auth,
  User, Customer, Amenity, RoomType, Room, Booking, Payment, VNPay, Health, and
  Dashboard.
- Applied concrete 2xx schemas to every JSON operation.
- Added standard 401/403 and important mutation error schemas.
- Added a contract validator to OpenAPI generation. Generation now fails if any
  documented response other than 204 has no `application/json` schema.
- Added snapshot drift check through `npm run openapi:check`.
- Regenerated `docs/openapi.json`.

## Verified results

- OpenAPI operations: 66.
- Documented responses missing JSON schema: 0.
- Component schemas: 67.
- Backend build: pass.
- Backend lint: pass.
- Backend unit: 41 suites, 276 tests pass.
- Backend E2E: 1 suite, 36 tests pass.
- Test migration state: 14/14 applied; schema drift 0.
- Read-only data audit: 10/10 checks pass.

## Not completed by this repository

- Generate all frontend core response types from this snapshot.
- Replace duplicated handwritten frontend response types.
- Prove frontend typecheck fails when a backend response field is removed.

Those tasks belong to the frontend repository and must be completed before the
cross-repository Phase 1 gate is marked complete.

## Sequence note

Backend Phase 2 service split and the module-by-module backend audit are now
implemented. The cross-repository Phase 1 gate remains dependent on frontend
generated contracts and frontend typecheck/browser evidence.
