# Homestay Booking Management System API

NestJS API for customer authentication, staff administration, customer
profiles, room types, rooms, and room images.

## Requirements

- Node.js 22+
- MySQL 8.4
- npm

## Environment

Create `.env` from `.env.example` and provide the database credentials.
`JWT_ACCESS_TOKEN_SECRET` is required and must contain at least 32 characters.
The application intentionally refuses to start when this value is missing or
too short.

```env
APP_PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USERNAME=property_user
DB_PASSWORD=your_database_password
DB_DATABASE=property_management
JWT_ACCESS_TOKEN_SECRET=replace_with_a_long_random_secret
JWT_ACCESS_TOKEN_EXPIRES_IN=1h
```

## Install And Run

```bash
npm install
npm run migration:run
npm run start:dev
```

The API is available at `http://localhost:3000/api`.

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

Customer and user phone numbers are normalized to Vietnamese E.164 format,
such as `+84705840355`, before uniqueness checks and storage. Login accepts the
equivalent `0`, `84`, or `+84` form. Existing noncanonical phone data should be
audited and cleaned in a controlled maintenance task; migrations do not rewrite
production phone values automatically.

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

Room type list endpoints accept `page`, `limit`, and `search`. The admin list
also accepts `includeDeleted=true`.

`basePrice` is returned as a decimal string such as `"1250000.00"` to preserve
money precision. Deleting a room type is a soft delete and is rejected while an
active room still references that type.

The RoomType admin namespace is intentionally retained because its list and
detail responses can include soft-deleted records and support restoration,
which is a different management view from the public resource.

### Rooms

Public:

- `GET /api/v1/rooms`
- `GET /api/v1/rooms/:id`
- `GET /api/v1/rooms/search`

Management (`ADMIN` or `STAFF`):

- `GET /api/v1/management/rooms`
- `GET /api/v1/management/rooms/:id`

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

Images are registered by URL rather than uploaded as binary files:

```json
{
  "imageUrl": "https://example.com/rooms/a101.jpg",
  "sortOrder": 0,
  "isCover": true
}
```

Search requires `checkIn`, `checkOut`, and `guests`, for example:
`GET /api/v1/rooms/search?checkIn=2026-08-01&checkOut=2026-08-03&guests=2`.
Optional filters are `roomTypeId`, `minPrice`, `maxPrice`, `page`, and `limit`.

Room status is one of `READY`, `OCCUPIED`, `CLEANING`, `MAINTENANCE`, or
`HIDDEN`. Staff can update operational statuses but only admins can set
`HIDDEN` or reopen a room that is already `HIDDEN`. Room deletion is permanent
when there is no booking/calendar history; otherwise the API returns `409` and
the room should be set to `HIDDEN`.

## Verification

```bash
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
```
