# Homestay Booking Management System API

Backend API for a homestay operation: customer accounts, staff administration,
room inventory and availability, bookings, manual payments, VNPay payments,
refunds, and audit records. The application is a NestJS modular monolith backed
by MySQL and is delivered as a single backend application.

## Overview

The main business relationships are:

```text
Customer/staff client
    +--> Booking ----> Room calendar
    +--> Payment ----> VNPay (online payment/refund/query)
                   |
                   +--> Booking payment lifecycle
```

Booking, Payment, and Room own the important consistency rules. Critical
mutations use TypeORM transactions and database pessimistic locks. Retryable
booking/payment/VNPay-refund commands use idempotency data so a retry can be
replayed or rejected as a conflict.

For the detailed module map and lock boundaries, see
[`docs/architecture.md`](docs/architecture.md). For payment behavior, see
[`docs/payment-flows.md`](docs/payment-flows.md). The Payment/Refund data-model
decision is recorded in
[`docs/decisions/payment-refund-model-decision.md`](docs/decisions/payment-refund-model-decision.md).

## Tech Stack

- Node.js 22.x and TypeScript
- NestJS 11
- TypeORM with MySQL 8.4
- `class-validator` / `class-transformer`
- Swagger/OpenAPI
- Jest, ts-jest, and Supertest
- VNPay SDK (`vnpay`)
- Sharp for room-image processing
- Helmet and `@nestjs/schedule`

## Architecture

This is a modular monolith organized by business module. Controllers handle
HTTP concerns, facade/capability services coordinate use cases, policies hold
small business decisions, and TypeORM-backed stores perform persistence inside
the caller's transaction.

```text
HTTP request
    |
    v
Guards + DTO validation + controllers
    |
    v
Facade/capability services
    |
    +--> business policies / lifecycle coordination
    |
    +--> TypeORM transaction runner + persistence stores --> MySQL
    |
    +--> VnPayGatewayService -----------------------------> VNPay
    +--> RoomImageStorageService --------------------------> local filesystem
```

Some core workflows use small domain policies and persistence boundaries to
make transaction/locking rules explicit, but the project intentionally keeps a
simple modular-monolith structure without introducing a separate architecture
framework.

See [`docs/architecture.md`](docs/architecture.md) for ownership and runtime
details.

## Main Modules

| Module | Responsibility |
|---|---|
| Auth | Customer/user login, access tokens, actor and role guards |
| Customer | Customer profile, password, and customer administration |
| User | ADMIN-managed staff accounts |
| Amenity | Public catalog and ADMIN CRUD/restore |
| RoomType | Room types, beds, amenities, and ADMIN management |
| Room | Inventory, status, availability, calendar blocks, images, search |
| Booking | Creation, queries, cancellation, status lifecycle, expiry |
| Payment | Manual payment, VNPay collection, callbacks, refund, reconciliation |
| Audit | Transactional business audit records |
| Common/Health | HTTP envelope, validation, request context, liveness/readiness |

Public and management routes are separated where visibility or actor permissions
differ. The full contract is in [`openapi/openapi.json`](openapi/openapi.json).

## Authentication Architecture

Access tokens are HS256 JWTs signed through `@nestjs/jwt` (`AccessTokenService`
facade). Token issuance, verification, and principal resolution are separated so
each layer stays independently testable and a future WebSocket gateway can reuse
the non-HTTP layers directly.

| Component | Responsibility |
|---|---|
| `AuthService` | login/register orchestration; issues tokens via `AccessTokenService` |
| `AccessTokenService` | issuance + `verify()` facade over `@nestjs/jwt`; JWT configuration (HS256, `JWT_ACCESS_TOKEN_SECRET`, duration grammar). Never touches the database. |
| `AccessTokenClaimsValidator` | pure claim invariants: `sub`/`actor_type`/IDs/token_version/role shape, `iat <= now+60`, `exp > iat`, expiry. No DB, no HTTP. |
| `AccessTokenPrincipalService` | application authentication state via authorization readers: account exists, `token_version` matches the DB, LOCKED → 403, user role refreshed from the DB (DB is the authorization source of truth; the JWT role is only a snapshot). |
| `JwtStrategy` (passport-jwt) | HTTP adapter only: strict `Bearer <token>` extraction, library crypto verification, header `alg`/`typ` check, then claims validation → principal resolution. Returns the canonical `AuthenticatedPrincipal`. |
| `JwtAuthGuard` | sets canonical `request.user` and derives the legacy `request.auth` view from it (deterministic adapter — the two can never drift). |
| `ActorsGuard` / `RolesGuard` | authorization (route metadata), reading `request.auth`. |

Token contract claims: `sub` (`customer:<id>` / `user:<id>`), `actor_type`,
`customer_id`/`user_id`, `token_version` (non-negative integer; bumping it in the
DB revokes outstanding tokens), `role` (user tokens only; not authoritative),
`iat`, `exp`. Locked accounts are rejected with 403 while their token version is
still valid.

A future WebSocket gateway should authenticate with
`AccessTokenService.verify()` → `AccessTokenClaimsValidator` →
`AccessTokenPrincipalService.resolve()` and attach the principal to
`socket.data.auth`; `JwtStrategy`/`JwtAuthGuard`/`request.user` remain HTTP-only
Passport concepts.

## Core Business Flows

- **Booking:** validate dates, capacity, customer/contact data, and room
  availability; create the booking, reserve each stay night, and write the
  audit record in one transaction.
- **Manual payment:** a STAFF/ADMIN records `CASH` or `BANK_TRANSFER`; the
  server uses the booking total, locks the booking, creates a successful payment,
  and lets the lifecycle coordinator mark the booking paid/confirmed.
- **VNPay:** the customer creates a pending payment and receives a signed URL.
  VNPay IPN is the server-to-server mutation path. Return is read-only
  presentation; it does not confirm a payment.
- **Refund:** manual refunds complete locally. VNPay refunds use a pending
  state before the external call and only become `REFUNDED` after a verified
  full-refund result. Unknown results remain available for reconciliation.

Detailed diagrams and status handling are in
[`docs/payment-flows.md`](docs/payment-flows.md).

## Transaction, Locking, and Idempotency

- TypeORM transactions are used for booking creation/cancellation/expiry,
  calendar reservation/blocking, payment acceptance, and refund state changes.
- Critical workflows use `pessimistic_write` (`FOR UPDATE` at the database
  level) for records such as Booking, Payment, Room, or a canonical payment.
- Booking creation stores an optional actor-scoped request intent. Manual
  payment, VNPay creation, and VNPay refund commands require an
  `Idempotency-Key` where applicable.
- A matching operation/key is replayed or reconciled; reuse for another
  booking/payment or an incompatible operation is rejected.
- Cross-entity state changes are owned by
  `BookingPaymentLifecycleService`, which keeps Booking, Payment, Room Calendar,
  and audit updates together in the application workflow.

The exact lock order and transaction boundaries are documented in
[`docs/architecture.md`](docs/architecture.md).

## Project Structure

```text
src/
├── bootstrap/          # global HTTP setup
├── common/             # HTTP, validation, health, transaction support
├── config/             # environment and image-storage configuration
├── database/           # datasource, migrations, scripts, seed
├── openapi/            # Swagger setup and contract checks
└── module/
    ├── auth/
    ├── customer/
    ├── user/
    ├── amenity/
    ├── room-type/
    ├── room/
    ├── booking/
    ├── payment/
    └── audit/

scripts/                # schema, data, OpenAPI, and smoke checks
test/
├── unit/               # unit/service/policy/config/contract tests
└── <feature>/          # MySQL-backed HTTP workflow tests
```

## Getting Started

### Requirements

- Node.js 22.x
- npm
- MySQL 8.4, or Docker Desktop/Engine for the repository's MySQL Compose
  service

### Environment Variables

The application reads `.env`, except when `NODE_ENV=test`, when it reads
`.env.test`. Start from the example files and replace all credential/secret
placeholders; do not commit `.env` files.

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` before starting MySQL or the API. VNPay is disabled by default in
the development example; enable it and provide sandbox credentials when you
need to exercise the online-payment flow.

| Area | Variables |
|---|---|
| Runtime | `NODE_ENV`, `APP_PORT`, `CORS_ORIGINS`, `SWAGGER_ENABLED`, `HTTP_JSON_BODY_LIMIT`, `HTTP_URLENCODED_BODY_LIMIT` |
| Database | `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`, `DB_POOL_SIZE`, `DB_POOL_QUEUE_LIMIT`, `DB_CONNECT_TIMEOUT_MS`, `HEALTH_DB_PROBE_TIMEOUT_MS` |
| Auth | `JWT_ACCESS_TOKEN_SECRET`, `JWT_ACCESS_TOKEN_EXPIRES_IN` |
| Booking/expiry | `BOOKING_PAYMENT_TIMEOUT_MINUTES`, `BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER`, `BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER`, `BOOKING_MAX_ADVANCE_DAYS`, `EXPIRATION_SCHEDULERS_ENABLED` |
| Images | `ROOM_IMAGE_UPLOAD_DIR` |
| VNPay | `VNPAY_ENABLED`, `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_PAYMENT_URL`, `VNPAY_RETURN_URL`, `VNPAY_FRONTEND_RETURN_URL`, `VNPAY_REQUEST_TIMEOUT_MS` |
| Admin seed | `SEED_ADMIN_FULL_NAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PHONE`, `SEED_ADMIN_PASSWORD` |
| Compose only | `MYSQL_ROOT_PASSWORD` |

`JWT_ACCESS_TOKEN_SECRET` must be at least 32 characters and must not be one of
the example values. When VNPay is enabled, the terminal code must be exactly
8 alphanumeric characters and the hash secret must be at least 16 characters.
Production requires a non-empty exact CORS allowlist. With VNPay enabled in
production, `VNPAY_RETURN_URL` must be public HTTPS; a configured
`VNPAY_FRONTEND_RETURN_URL` must also be public HTTPS.

### Install, Database, and Run

```bash
npm install

# Optional: use the repository's MySQL-only Compose topology.
docker compose up -d mysql

npm run start:dev
```

The API listens on `http://localhost:3000/api` by default. If an existing MySQL
instance is used, configure the `DB_*` variables and skip the Compose command.
When the API starts, TypeORM automatically runs pending migrations against the
configured database.

To create a local ADMIN account, set the `SEED_ADMIN_*` variables and run:

```bash
npm run seed:admin
```

`compose.yaml` provisions MySQL only; this repository does not provide an API
container or a production orchestration manifest.

## Database Migrations

TypeORM `synchronize` is disabled. Schema changes remain explicit migrations in
`src/database/migrations`; the runtime applies pending migrations automatically
when the API starts. The CLI commands are still available for checking or
applying migrations before startup.

```bash
npm run migration:show
npm run migration:run
npm run schema:check
npm run data:audit
```

`npm run migration:revert` exists, but do not use it casually against a shared
or pre-existing database. The baseline migration is intentionally not a safe
automatic data-destructive rollback.

## Testing

```bash
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run test:cov
npm run lint
npm run build
npx tsc -p tsconfig.build.json --noEmit
```

Before E2E tests, create `.env.test` from `.env.test.example` and point it to a
dedicated MySQL database whose name ends with `_test`:

```bash
cp .env.test.example .env.test
```

PowerShell equivalent:

```powershell
Copy-Item .env.test.example .env.test
```

The E2E setup checks `NODE_ENV=test` and the `_test` database suffix before
migrations, inserts, deletes, or cleanup. It refuses to run against a normal
development or production database. E2E schedulers are disabled by the example
configuration.

## OpenAPI / Swagger

Set `SWAGGER_ENABLED=true` to expose:

- Swagger UI: `http://localhost:3000/api/docs`
- JSON document: `http://localhost:3000/api/docs-json`

The committed snapshot is `openapi/openapi.json`.

```bash
npm run openapi:generate
npm run openapi:check
npm run openapi:validate
```

Regenerate the snapshot after a route or DTO contract change.

Health endpoints are available independently of Swagger:

- `GET /api/health/live` — process liveness
- `GET /api/health/ready` — bounded MySQL readiness probe

## Important Design Decisions

1. VNPay IPN is the financial mutation authority; browser Return is verified
   presentation and recovery UX only.
2. Booking, Payment, and Room Calendar changes that must agree are committed in
   a single transaction where the workflow owns them.
3. Pessimistic locks serialize concurrent booking/payment/refund decisions;
   database uniqueness constraints remain the final conflict guard.
4. `BookingPaymentLifecycleService` owns cross-entity payment side effects.
5. External VNPay refund calls happen outside the database transaction; uncertain
   outcomes remain `REFUND_PENDING` for reconciliation.
6. Migrations are explicit and `synchronize` is disabled.

## Current Limitations

- The MVP supports full payments and one online provider (VNPay); partial,
  installment, split, overpayment, and payment-ledger allocation are outside
  the current scope.
- Room images use local filesystem storage. Filesystem and MySQL writes are not
  one atomic transaction, and there is no object-storage adapter in this repo.
- Rate limiting and the minute-based expiry schedulers are process-local. A
  multi-instance deployment would need shared rate-limit storage and scheduler
  coordination.
- Compose provisions only MySQL. API packaging, deployment topology, secret
  management, and TLS termination are outside this repository.
- VNPay production configuration, reconciliation operations, and financial
  controls need deployment-specific validation; this project does not claim
  PCI compliance or absolute production security.

## Future Improvements

- Add object-backed room-image storage and a cleanup/retention process.
- Add distributed rate-limit and scheduler coordination if multiple API
  instances are needed.
- Add operational metrics/tracing for payment, reconciliation, and scheduler
  outcomes.
- Add another payment provider or a payment ledger only when business scope
  requires it.
