# Homestay Booking Management System API

NestJS API for customer authentication, staff administration, customer
profiles, room inventory and availability, bookings, manual/VNPay payments,
refund operations, audit records, and an operational dashboard.

## MVP Payment Scope

The payment MVP focuses on one full payment for a customer-created online
booking through one VNPay sandbox/mock-compatible integration. Inventory is
held for 15 minutes. A verified server-to-server IPN/webhook is the sole target
financial mutation authority; the Return URL is verified presentation/read-only
and clients re-query local state. Payment creation and callback handling are
idempotent, with duplicate callbacks and callback-vs-timeout races as required
test targets. This is an MVP technical demonstration, not a production
financial-system or PCI certification claim.

## Known Limitations / Future Work

- Partial, installment, split, and multiple accepted collections are not supported.
- Counter installment/debt tracking and the `PARTIALLY_PAID`, `collectedAmount`,
  and `remainingAmount` model are outside MVP scope.
- Multi-provider routing, payment ledger/allocation, overpayment/credit, and
  complex partial-refund allocation are outside MVP scope.
- Production-grade VNPay configuration, reconciliation, refund-lineage, and
  operational hardening require additional validation and work.

## Requirements

- Node.js 22.x
- MySQL 8.4
- npm

## Environment

Create `.env` from `.env.example` and provide the database credentials.
`JWT_ACCESS_TOKEN_SECRET` is required and must contain at least 32 characters.
The application intentionally refuses to start when this value is missing or
too short.

```env
NODE_ENV=development
APP_PORT=3000
CORS_ORIGINS=http://localhost:5173
SWAGGER_ENABLED=false
HTTP_JSON_BODY_LIMIT=1mb
HTTP_URLENCODED_BODY_LIMIT=1mb
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USERNAME=property_user
DB_PASSWORD=your_database_password
DB_DATABASE=property_management
JWT_ACCESS_TOKEN_SECRET=replace_with_a_long_random_secret
JWT_ACCESS_TOKEN_EXPIRES_IN=1h
BOOKING_PAYMENT_TIMEOUT_MINUTES=15
VNPAY_ENABLED=false
VNPAY_TMN_CODE=
VNPAY_HASH_SECRET=
VNPAY_PAYMENT_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html
VNPAY_RETURN_URL=http://localhost:3000/api/v1/payments/vnpay/return
VNPAY_FRONTEND_RETURN_URL=
```

Set `VNPAY_ENABLED=true` only after receiving a Sandbox terminal code and hash
secret. The VNPay IPN URL registered for the terminal is:

```text
https://<public-api-origin>/api/v1/payments/vnpay/ipn
```

`CORS_ORIGINS` accepts a comma-separated list of exact frontend origins.
Production startup requires a non-empty allowlist. When VNPay is enabled in
production, `VNPAY_RETURN_URL` must also be a public HTTPS URL.
`VNPAY_FRONTEND_RETURN_URL` is optional. When configured, the verified backend
Return endpoint responds with a redirect to that frontend result page.
Swagger UI and its JSON endpoint are controlled by `SWAGGER_ENABLED`; production
defaults to disabled. JSON and URL-encoded request bodies are bounded by the
two `HTTP_*_BODY_LIMIT` settings.

## Install And Run

```bash
npm install
npm run migration:run
npm run start:dev
```

The API is available at `http://localhost:3000/api`.

Current working-tree limitation: `npm run build` emits `dist/src/main.js`, while
`npm run start:prod` points to `dist/main`. The production start command therefore
fails with `MODULE_NOT_FOUND` until the build output or script is aligned.

## Database Migrations

The first migration is an idempotent baseline for the eight tables that
existed before migrations were introduced. It uses `CREATE TABLE IF NOT EXISTS`,
so it can be recorded safely on the existing development database and can also
initialize an empty database.

```bash
npm run migration:show
npm run migration:run
```

The baseline migration cannot be reverted automatically because doing so on a
pre-existing database could delete production data. Restore a database backup
instead.

## E2E Database

Create `.env.test` from `.env.test.example` and point it to a dedicated MySQL
database whose name ends with `_test`. The E2E setup loads only `.env.test` and
stops before migrations or test data changes when `NODE_ENV` is not `test`, the
database name is empty, or the name does not end with `_test`.

```bash
npm run test:e2e
```

## Test Layout

Production code under `src/` must not contain `*.spec.ts` files. Keep isolated
unit, service, policy, helper, configuration, database-contract, and OpenAPI
specifications under `test/unit/`, mirroring the relevant `src/` path. Keep
HTTP/database workflow tests under `test/<feature>/` with the `.e2e-spec.ts`
suffix.

When creating a new test, place it under `test/unit/` or the relevant
`test/<feature>/` folder instead of the production source folder. Unit tests run
with `npm test`; E2E tests run with `npm run test:e2e`.

## Main Endpoints

### Authentication

- `POST /api/v1/auth/customers/register`
- `POST /api/v1/auth/customers/login`
- `POST /api/v1/auth/users/login`
- `GET /api/v1/auth/me`

Registration is limited to five requests per IP every 15 minutes. Login is
limited to ten requests per IP every 15 minutes.

### Customer And User Administration

- `GET /api/v1/customers/me`
- `PATCH /api/v1/customers/me`
- `PATCH /api/v1/customers/me/password`
- `PATCH /api/v1/management/customers/:id/initial-password`
- `POST /api/v1/users`
- `GET /api/v1/users`
- `PATCH /api/v1/users/:id`
- `PATCH /api/v1/users/:id/status`
- `GET /api/v1/customers`
- `PATCH /api/v1/customers/:id/status`

The account-issuing endpoint creates `STAFF` accounts only. An admin cannot
lock or demote their own account. Account status endpoints accept:

```json
{
  "status": "LOCKED"
}
```

Resetting a user password increments the user's token version. Access tokens
issued before that change are rejected, and the user must log in again.

Changing a Customer password has the same token-revocation behavior:

```json
{
  "currentPassword": "CurrentPassword123!",
  "newPassword": "NewPassword456!"
}
```

`ADMIN` or `STAFF` can set an initial password for a Customer created at the
counter by sending `{ "password": "TemporaryPassword123!" }` to the management
endpoint. This operation is accepted only while `passwordHash` is null; later
calls return `409`. There is no public account-claim or fake email/OTP flow.

Customer and user phone numbers are normalized to Vietnamese E.164 format,
such as `+84705840355`, before uniqueness checks and storage. Login accepts the
equivalent `0`, `84`, or `+84` form. Existing noncanonical phone data should be
audited and cleaned in a controlled maintenance task; migrations do not rewrite
production phone values automatically.

```bash
npm run phone:normalize:check
npm run phone:normalize:run
```

The first command is a read-only preflight. The apply command rechecks invalid
values and canonical collisions while holding database locks, then updates all
eligible records in one transaction. Production apply additionally requires the
explicit `--allow-production` flag.

### Room Types

Public:

- `GET /api/v1/room-types`
- `GET /api/v1/room-types/:id`

Admin:

- `POST /api/v1/admin/room-types`
- `GET /api/v1/admin/room-types`
- `GET /api/v1/admin/room-types/:id`
- `PATCH /api/v1/admin/room-types/:id`
- `DELETE /api/v1/admin/room-types/:id`
- `PATCH /api/v1/admin/room-types/:id/restore`
- `PUT /api/v1/admin/room-types/:id/amenities`

Room type list endpoints accept `page`, `limit`, and `search`. The admin list
also accepts `includeDeleted=true`.

`basePrice` is returned as a decimal string such as `"1250000.00"` to preserve
money precision. Deleting a room type is a soft delete and is rejected while an
active room still references that type.

The RoomType admin namespace is intentionally retained because its list and
detail responses can include soft-deleted records and support restoration,
which is a different management view from the public resource.

### Amenities

Public:

- `GET /api/v1/amenities`
- `GET /api/v1/amenities/:id`

Admin:

- `POST /api/v1/admin/amenities`
- `GET /api/v1/admin/amenities`
- `GET /api/v1/admin/amenities/:id`
- `PATCH /api/v1/admin/amenities/:id`
- `DELETE /api/v1/admin/amenities/:id`
- `PATCH /api/v1/admin/amenities/:id/restore`

Amenities are a shared catalog assigned to RoomType records. `PUT
/api/v1/admin/room-types/:id/amenities` replaces the complete assignment and
accepts `{ "amenityIds": ["1", "2"] }`; sending an empty array removes every
assignment. Deleted amenities are excluded from public Amenity, RoomType, and
Room responses.

### Rooms

Public:

- `GET /api/v1/rooms`
- `GET /api/v1/rooms/:id`
- `GET /api/v1/rooms/search`

Management (`ADMIN` or `STAFF`):

- `GET /api/v1/management/rooms`
- `GET /api/v1/management/rooms/:id`
- `GET /api/v1/management/rooms/:roomId/calendar`
- `POST /api/v1/management/rooms/:roomId/blocks`
- `DELETE /api/v1/management/rooms/:roomId/blocks`

Admin and staff operations:

- `POST /api/v1/rooms`
- `PATCH /api/v1/rooms/:id`
- `DELETE /api/v1/rooms/:id`
- `PATCH /api/v1/rooms/:id/status`
- `POST /api/v1/rooms/:roomId/images`
- `DELETE /api/v1/room-images/:imageId`
- `PATCH /api/v1/room-images/:imageId/set-cover`

Room URLs describe resources rather than actors. Public reads exclude
`HIDDEN` and `MAINTENANCE` rooms. Management reads include every active room
status and support filtering by `status`. Room status updates accept `STAFF`
and `ADMIN`, while all other write operations require `ADMIN`.

Create a room with:

```json
{
  "roomTypeId": "5",
  "roomNumber": "A101",
  "name": "Phong A101",
  "description": "Phong gan san vuon"
}
```

Room images are uploaded as `multipart/form-data`. The `file` field is
required; `sortOrder` and `isCover` are optional text fields:

```text
file=<JPEG, PNG, or WebP binary>
sortOrder=0
isCover=true
```

The upload must not exceed 8 MiB. The API validates the decoded image,
limits it to 25 megapixels, resizes it to at most 2560x2560, stores it as
WebP, and returns a relative `imageUrl` under `/media/room-images/...`.
Configure `ROOM_IMAGE_UPLOAD_DIR` as a dedicated directory; runtime files are
ignored by Git.

Search requires `checkIn`, `checkOut`, and `guests`, for example:
`GET /api/v1/rooms/search?checkIn=2026-08-01&checkOut=2026-08-03&guests=2`.
Optional filters are `roomTypeId`, repeated `amenityIds`, `minPrice`,
`maxPrice`, `page`, and `limit`. Multiple amenity IDs use AND semantics: the
RoomType must contain every selected active amenity.

Room status is one of `READY`, `OCCUPIED`, `CLEANING`, `MAINTENANCE`, or
`HIDDEN`. Staff can update operational statuses but only admins can set
`HIDDEN` or reopen a room that is already `HIDDEN`. Room deletion is permanent
when there is no booking/calendar history; otherwise the API returns `409` and
the room should be set to `HIDDEN`.

Management calendar ranges use the same half-open `[from, to)` convention as
bookings. Admin and staff can block a room for operational reasons:

```http
POST /api/v1/management/rooms/21/blocks
Content-Type: application/json

{
  "from": "2030-08-01",
  "to": "2030-08-04",
  "reason": "Bao tri may lanh"
}
```

Use
`GET /api/v1/management/rooms/21/calendar?from=2030-08-01&to=2030-09-01`
to read blocked and reserved nights. Reserved entries expose only the booking
ID and booking code. Use the same `from` and `to` query parameters with
`DELETE /api/v1/management/rooms/21/blocks` to remove blocked nights.
Unblocking never removes booking reservations. A conflicting booking or block
returns `409` and rolls back the entire requested range. Calendar requests are
limited to 366 nights.

### Bookings

Customer:

- `POST /api/v1/bookings`
- `GET /api/v1/bookings`
- `GET /api/v1/bookings/:id`
- `PATCH /api/v1/bookings/:id/cancel`

Management (`ADMIN` or `STAFF`):

- `POST /api/v1/management/bookings`
- `GET /api/v1/management/bookings`
- `GET /api/v1/management/bookings/:id`
- `PATCH /api/v1/management/bookings/:id/status`

Customer booking creation uses the authenticated customer as the owner.
Contact fields are optional snapshots and default to the customer profile:

```json
{
  "roomId": "5",
  "checkInDate": "2030-08-01",
  "checkOutDate": "2030-08-03",
  "guestCount": 2,
  "customerNote": "Phong tang tret neu con"
}
```

For a counter booking, management may provide an existing `customerId`.
Without `customerId`, `contactName` and `contactPhone` are required. The
service finds the customer by normalized phone or creates a customer without a
password:

```json
{
  "roomId": "5",
  "checkInDate": "2030-08-01",
  "checkOutDate": "2030-08-03",
  "guestCount": 2,
  "contactName": "Pham Van Tan",
  "contactPhone": "0705 840 355",
  "contactEmail": "tan@example.com"
}
```

Booking creation and nightly `room_calendar` reservations run in one
transaction. The unique room/date constraint is the final double-booking
guard. A stay is limited to 90 nights, guest count cannot exceed room type
capacity, and `HIDDEN` or `MAINTENANCE` rooms cannot be booked. The total amount
is calculated from the current room type base price and stored as a decimal
snapshot.

Management transitions are:

- `PENDING_PAYMENT` to `CONFIRMED` or `CANCELLED`
- `CONFIRMED` to `CHECKED_IN` or `CANCELLED`
- `CHECKED_IN` to `CHECKED_OUT`

Customer cancellation is allowed from `PENDING_PAYMENT` or `CONFIRMED`.
Cancellation keeps the booking record and removes its calendar reservations in
the same transaction. A paid booking must be refunded by an admin instead of
being cancelled directly. Check-in requires `paymentStatus=PAID`.
Only staff-created counter bookings may be confirmed while still unpaid.
Check-in is accepted from the booking check-in date until before its check-out
date. A successful check-in sets the Room to `OCCUPIED`; check-out sets it to
`CLEANING` unless the Room is under a hidden or maintenance override.

New bookings receive a `paymentExpiresAt` timestamp. A scheduled cleanup marks
an expired `PENDING_PAYMENT` booking as `CANCELLED` and removes its calendar
reservations. The timeout is configured by
`BOOKING_PAYMENT_TIMEOUT_MINUTES`, which defaults to 15.

### Payments

Customer payment history:

- `GET /api/v1/bookings/:bookingId/payments`
- `POST /api/v1/bookings/:bookingId/payments`

Management (`ADMIN` or `STAFF`):

- `GET /api/v1/management/payments`
- `GET /api/v1/management/bookings/:bookingId/payments`
- `POST /api/v1/management/bookings/:bookingId/payments`

Admin:

- `POST /api/v1/management/payments/:id/refund`
- `POST /api/v1/management/payments/:id/reconcile-refund`

Manual payment supports `CASH` or `BANK_TRANSFER`. Management payment creation
requires an `Idempotency-Key` header and does not accept an amount from the
client:

```http
Idempotency-Key: counter-booking-21-cash-001
```

```json
{
  "method": "CASH"
}
```

The server copies the immutable booking total into the payment. Payment and
booking updates run in one transaction. A successful payment sets
`paymentStatus=PAID`, clears `paymentExpiresAt`, and moves a
`PENDING_PAYMENT` booking to `CONFIRMED`. `CONFIRMED + UNPAID` remains valid
for reservations that will pay at the property, but they cannot check in until
payment is recorded.

Customer VNPay payment creation also requires an `Idempotency-Key`. The body is
optional:

```http
Idempotency-Key: booking-21-vnpay-attempt-001
```

```json
{
  "bankCode": "VNBANK",
  "locale": "vn"
}
```

`bankCode` accepts `VNPAYQR`, `VNBANK`, or `INTCARD`; omit it to let the
customer choose on VNPay. The response includes `paymentUrl` and `expiresAt`.
The frontend must redirect the browser to `paymentUrl`.

Public VNPay callbacks:

- `GET /api/v1/payments/vnpay/return`
- `GET /api/v1/payments/vnpay/ipn`

Current implementation uses IPN as the primary server-to-server path, while a
correctly signed Return can still apply the shared idempotent update as a
fallback. The MVP target intentionally narrows this: IPN/webhook is the only
financial mutation authority and Return becomes verified read-only
presentation/recovery UX. After Return, the frontend reloads booking/payment
history and trusts local database state; before IPN it may remain `PENDING`.

When `VNPAY_FRONTEND_RETURN_URL` is empty, Return responds with JSON. When it is
configured, Return responds with `302` and includes `paymentId`, `bookingId`,
`paymentStatus`, and verified gateway result codes in the frontend URL.

Expired online attempts are marked `FAILED` with response code `EXPIRED`.
Customer or management cancellation closes a pending VNPay attempt in the same
transaction with response code `CANCELLED`.
If a valid successful IPN arrives after its booking has already been cancelled,
the payment becomes `REQUIRES_REVIEW`; the cancelled booking and released room
calendar are not silently restored. Management can find these transactions via
`GET /api/v1/management/payments?status=REQUIRES_REVIEW`.

Only an admin can refund. Manual payments support a local full refund before
check-in. VNPay refunds require an `Idempotency-Key` and use a two-phase flow:
the Payment becomes `REFUND_PENDING` before the gateway call, then becomes
`REFUNDED` only after a verified full-refund response. Timeouts and ambiguous
responses remain pending for `queryDr` reconciliation; the same key never
sends a second refund. Booking transitions are blocked while reconciliation
is pending.

## Frontend Integration

When `SWAGGER_ENABLED=true`, runtime OpenAPI documentation is available at
`/api/docs`, with the raw document at `/api/docs-json`. The version-controlled
snapshot path is [`openapi/openapi.json`](openapi/openapi.json). Regenerate it
after a contract change:

```bash
npm run openapi:generate
```

Room Calendar request and response types in the Frontend are generated from
this snapshot with the Frontend `npm run contract:generate` script.

## Verification

```bash
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run test:cov
```

`test:cov` produces separate unit and E2E coverage reports. This keeps isolated
unit coverage visible while also measuring controller and service execution
through the real API and test database.
