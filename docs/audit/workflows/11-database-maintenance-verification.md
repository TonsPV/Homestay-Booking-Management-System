# Lượt 11 - Database và maintenance verification

Date: 2026-08-01  
Scope: Migration registration/order, schema drift, rollback/reapply on the
MySQL test copy, constraints/indexes/collation, data audit, seed safety, phone
normalization and representative query plans.

## 1. Migration and schema evidence

| Check | Result | Evidence |
|---|---|---|
| Migration registration/order | VERIFIED | `src/database/data-source.ts` registers 14 timestamped migrations in ascending order. Test `migration:show` reports all 14 applied. |
| Apply pending migrations on test copy | VERIFIED | After controlled rollback, `migration:run` applied `AddDashboardQueryIndexes1784782000000` and `AlignAmenityJoinMetadata1784783000000`; a second run reports “No migrations are pending”. |
| Rollback/reapply proof | VERIFIED | Both latest migrations were reverted on `hbms_test`, then reapplied successfully; no data-constraint error occurred. |
| Entity/schema drift on test copy | VERIFIED | `$env:NODE_ENV='test'; npm run schema:check` reports `Database schema matches entity metadata.` |
| Default/non-test environment release state | BLOCKED / ACTION REQUIRED | Without `NODE_ENV=test`, the configured local database still reports 12 applied + 2 pending and schema-check reports 13 operations. No migration was applied there because the database name was not proven to be a safe `_test` copy. |
| FK/unique/check/index constraints | VERIFIED | INFORMATION_SCHEMA inspection and existing application E2E show Booking/Payment/Calendar checks, unique gateway/idempotency keys, calendar ownership check and required indexes. |
| Collation semantics | CHARACTERIZED | `hbms_test` tables use `utf8mb4_0900_ai_ci`; email/name uniqueness and comparisons therefore follow the MySQL case/accent-insensitive collation, subject to the existing schema contract. |

## 2. Data and maintenance evidence

| Check | Result | Evidence |
|---|---|---|
| Data-audit invariants | VERIFIED | `npm run data:audit` on `hbms_test`: 10/10 checks PASS, 0 violations. |
| Seed ADMIN safety | VERIFIED / COVERED_BY_UNIT | `seed-admin.spec.ts` allows test/development, refuses production without `--allow-production`, and existing ADMIN email is not silently downgraded. |
| Phone normalization dry-run | VERIFIED | Test copy preflight: 8 planned changes, 0 invalid records, 0 collisions. |
| Phone normalization apply | VERIFIED | `phone:normalize:run` applied exactly 8 changes under the transaction/row-lock path; a subsequent dry-run reports 0 changes, 0 invalid, 0 collisions. This mutation was limited to `hbms_test`. |
| Production normalization guard | VERIFIED / COVERED_BY_CODE | `--apply` in production requires explicit `--allow-production`; no production apply was attempted. |
| Migration backup/restore | PARTIAL | Up/down was proven on the test copy. A physical backup restore or production-like snapshot was not available in the repository, so release restore evidence remains external. |

## 3. Representative query plans

Plans were collected with MySQL `EXPLAIN` on `hbms_test` after migrations,
using the current repository predicates. The database contained 19 rooms and a
small test dataset; these results are correctness/index evidence, not a scale
benchmark.

| Capability | Plan evidence | Assessment |
|---|---|---|
| Dashboard booking date/status range | `type=range`, key `idx_bookings_created_at_status`, estimated rows `1` | Expected composite index is selected. |
| Payment SUCCESS/paid_at range | `type=range`, key `idx_payments_status_paid_at`, estimated rows `1` | Expected payment reporting index is selected. |
| Public room catalog join/order | Room table `type=ALL`, estimated rows `19`, `Using temporary; Using filesort`; image join uses `idx_room_images_room`, room-type/amenity joins use PK indexes | Functional at current size; catalog order/filter plan should be rechecked on a production-sized dataset before claiming scale readiness. |

## 4. Architecture/design check

- Migration ownership is explicit in `src/database/data-source.ts`; entity
  metadata is not allowed to auto-synchronize (`synchronize: false`).
- Maintenance scripts are guarded and transactional: phone normalization
  performs preflight, collision/invalid checks, row locks and compare-and-set
  updates; seed-admin requires an explicit production flag.
- The remaining release risk is environment/process state (the non-test local
  database has pending migrations and schema drift), not an untracked entity
  mutation. It must be resolved on a restored/reviewed database copy before a
  release is called stable.

## 5. Verification commands

| Command | Result |
|---|---|
| `$env:NODE_ENV='test'; npm run migration:show` | PASS, 14/14 applied |
| `$env:NODE_ENV='test'; npm run migration:run` | PASS, no pending after reapply |
| `$env:NODE_ENV='test'; npm run schema:check` | PASS, no drift |
| `$env:NODE_ENV='test'; npm run data:audit` | PASS, 10/10 invariants |
| `$env:NODE_ENV='test'; npm run phone:normalize:check` | PASS, 8 planned before apply; 0 after apply |
| `$env:NODE_ENV='test'; npm run phone:normalize:run` | PASS, 8 applied changes |
| `npm run migration:show` without `NODE_ENV=test` | NOT_RELEASE_READY, 2 pending migrations on the configured non-test DB |

## 6. Lượt 11 conclusion

Status: **PASS on the isolated MySQL test copy, including migration
rollback/reapply, schema, constraints, audit, seed and phone maintenance;
default/non-test database remains BLOCKED until its two migrations and 13 drift
operations are applied and rechecked on a reviewed backup/restore copy.**

Proceed to Lượt 12 (cross-module journeys), then the final architecture,
hygiene, CI and release gate.
