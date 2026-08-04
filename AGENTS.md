# HBMS Backend Agent Instructions

This NestJS API follows an ECC-inspired, project-local workflow. Keep changes
conservative, tested, and aligned with the existing module style.

## Architecture Rules

- Modules are organized by domain under `src/module`.
- Public routes and management routes must stay clearly separated when actor
  visibility differs.
- Use existing guards/decorators before introducing new authorization patterns:
  `AccessTokenGuard`, `ActorsGuard`, `RolesGuard`, `@Actors`, `@Roles`.
- Use enums for actor, role, status, method, and state-machine decisions.
- Keep API responses inside the existing success/error envelope.
- Prefer TypeORM transactions for booking/payment/calendar/image mutations that
  must be atomic.

## Backend Module Checklist

For each new or changed module:

1. Entity and migration exist when persistence changes.
2. Request DTOs validate external input.
3. Response DTOs document returned data for Swagger.
4. Service owns business rules and throws clear Nest exceptions.
5. Controller only maps HTTP concerns to service calls.
6. Role/actor access is covered by E2E tests.
7. Business state transitions are covered by unit tests.
8. `docs/openapi.json` is regenerated after route or DTO changes.

## Business Areas To Treat Carefully

- Auth: token payload must match database `tokenVersion` and account status.
- Booking: date overlap, cancellation, expiry, room calendar locks, and counter
  booking must remain consistent.
- Payment: manual payment, VNPay collection, VNPay return/IPN, refund request,
  and refund reconciliation must not update status from unverified data.
- Room: public views must hide unavailable/admin-only inventory.
- Room Image: only one cover image per room.
- Phone: normalize Vietnamese phone numbers before unique checks, login lookup,
  and persistence.

## Testing Expectations

- Unit tests are required for every service-level business rule change.
- E2E tests are required for route authorization and main API flows.
- Keep E2E database safety guard intact:
  - `NODE_ENV=test`
  - database name ends with `_test`
  - guard runs before migrations, inserts, truncates, deletes, or cleanup
- Do not alter unrelated tests just to make a run pass.

## Commands

- Lint: `npm run lint`
- Unit: `npm run test`
- E2E: `npm run test:e2e`
- Coverage: `npm run test:cov`
- OpenAPI: `npm run openapi:generate`
- Migration show: `npm run migration:show`
- Migration run: `npm run migration:run`
- Data audit: `npm run data:audit`

## Refactor Boundaries

- Split large services only behind stable public methods.
- Do not change route names, enum values, response shape, or DB columns as part
  of a cleanup unless the task explicitly needs it.
- Payment and Booking can be decomposed into helper/capability services, but the
  first pass must preserve current controller behavior.
