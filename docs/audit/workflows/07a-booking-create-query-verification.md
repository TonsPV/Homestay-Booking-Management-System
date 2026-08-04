# Lượt 7A - Booking create/query workflow verification

Date: 2026-08-01  
Scope: customer online creation, customer ownership queries, management
queries, counter creation, admission quotas, price/calendar snapshots, and
same-room concurrency.

## 1. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| Online create for active Customer | VERIFIED | Real HTTP flow creates `PENDING_PAYMENT + UNPAID` booking with payment deadline. |
| Room/RoomType/date/guest validation | VERIFIED | Missing capacity, reversed dates, and >90-night requests return `400`; active Room/RoomType are loaded in the transaction. |
| Price snapshot and decimal total | VERIFIED | RoomType `125.00` over two nights is persisted/responded as `250.00`; later room catalog changes are not used for this booking. |
| RESERVED calendar ownership | VERIFIED | A two-night booking creates exactly two `RESERVED` rows with the same Booking/Room ownership. |
| Customer list/detail ownership | VERIFIED | Owner lists/details the Booking; another Customer receives `404` for the same resource. |
| Management list/detail | VERIFIED | STAFF management detail returns the created booking and the dedicated suite verifies `createdByUserId` projection. |
| Active unpaid quota | VERIFIED | Three active unpaid online bookings are admitted; the fourth returns `409`; cancellation releases calendar and quota, then a new booking succeeds. |
| Counter booking with existing Customer | VERIFIED | STAFF creates a booking against an existing Customer and the response snapshots the staff creator. |
| Counter booking with passwordless Customer | VERIFIED | Omitting `customerId` with contact data creates a new Customer with `passwordHash = NULL` and a staff-owned Booking. |
| Counter missing contact | VERIFIED | Missing contact name/phone returns `400` before persistence. |
| Concurrent online same Room/date | VERIFIED | Two Customers racing for the same room-night return exactly `[201,409]`; the winner owns both RESERVED rows. |
| Admission lock ownership | CHARACTERIZED | `BookingCreationService` locks Customer before admission counting, then locks the Room before writing Booking/Calendar; the E2E quota/concurrency outcomes agree with this order. |
| RoomType delete/update race | NOT_RUN | Cross-module race is deferred to the dedicated Booking/architecture gate; no unsupported green claim is made here. |

## 2. Architecture/design check

- `BookingService` remains a facade; `BookingCreationService` owns input
  normalization, admission, Room/RoomType checks, price snapshot, and the
  Booking + Calendar transaction. `BookingQueryService` owns customer versus
  management projections and filters.
- Customer and management controllers stay separate and use actor/role guards.
- Booking and all RESERVED calendar rows are created in one transaction, with
  duplicate room/date errors mapped to `409` by the existing service boundary.
- The suite uses `E2eHarness` and cleans dependent calendar rows before
  Booking/Customer fixtures; no global cleanup or test-database bypass was
  added.
- No route, response shape, enum, or database schema was changed in this
  slice. The test cleanup uses only exact fixture IDs/room/customer scopes.

## 3. Verification commands

| Command | Result |
|---|---|
| `npx jest --config ./test/jest-e2e.json --runInBand test/booking-create-query-workflow.e2e-spec.ts` | PASS, 1 suite / 4 tests |
| `npm run test:e2e -- --runInBand` | PASS, 13 suites / 78 tests |
| `npm run test -- --runInBand` | PASS, 42 suites / 302 tests |
| `npm run lint` | PASS |
| `npm run data:audit` | PASS, 10/10 invariants with 0 violations |

The application E2E suite's deliberate `Simulated VNPay timeout` remains an
expected fixture log and is unrelated to Booking creation/query behavior.

## 4. Lượt 7A conclusion

Status: **PASS for documented Booking creation/query workflows and concurrency
characterization**.

Proceed to Lượt 7B (Booking lifecycle/expiration), carrying forward the
cross-module Room occupancy finding (`CHECKED_IN ↔ OCCUPIED`) and the requirement
to rerun `data:audit` after each lifecycle transition.
