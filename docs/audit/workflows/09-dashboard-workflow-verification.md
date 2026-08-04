# Lượt 9 - Dashboard workflow verification

Date: 2026-08-01  
Scope: Management dashboard summary route, date/time boundaries, booking and
payment aggregates, room status/capacity, occupancy and reporting semantics.

## 1. Inventory

| Layer | Current implementation |
|---|---|
| Controller | `src/module/dashboard/dashboard.controller.ts` exposes one `GET /api/v1/management/dashboard/summary` route and delegates to the query service. |
| DTOs | `DashboardSummaryQueryDto` accepts `from` and `to`; response DTO documents booking, room, revenue, payment, refund and occupancy projections. |
| Service | `DashboardQueryService` runs six read-only aggregate queries in parallel and normalizes SQL numeric/null values. |
| Persistence/indexes | Range predicates use the dashboard query indexes from migration `1784782000000-AddDashboardQueryIndexes`. |
| Existing tests | Unit SQL/range tests plus existing application authorization/aggregate smoke test; this round adds `test/dashboard-workflow.e2e-spec.ts`. |

## 2. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| Anonymous access | VERIFIED / COVERED_BY_EXISTING | Existing application E2E receives `401` for the management route. |
| Customer access | VERIFIED / COVERED_BY_EXISTING | Existing application E2E receives `403`; management route is not a customer projection. |
| STAFF access and response envelope | VERIFIED | Dedicated and existing application E2E receive `200` with the documented response shape. |
| Invalid calendar date | VERIFIED | `2038-02-30` is rejected before any SQL query. |
| Reversed range | VERIFIED | `from > to` returns `400`. |
| Exactly 366 inclusive days | VERIFIED | `2038-01-01` through `2039-01-01` is accepted; 367 days is rejected. |
| Vietnam +07:00 boundary | VERIFIED | A payment at `2037-12-31 17:00:00Z` (2038-01-01 00:00 +07) is included in the `2038-01-01` range; the service uses `CONVERT_TZ` range predicates. |
| Booking counts | VERIFIED | Fixture deltas distinguish CONFIRMED and CANCELLED by `created_at`; counts are not inferred from payment rows. |
| Collected revenue by method | VERIFIED | SUCCESS payment with CASH contributes to `revenue.manual` and `revenue.total`; VNPAY and manual SQL branches are separate. |
| Refunded amount | VERIFIED | REFUNDED payment contributes to `totalRefunded` by `refunded_at` and does not contribute to collected revenue. |
| Review/pending payment metrics | VERIFIED | One `REQUIRES_REVIEW` and one `REFUND_PENDING` created in-range increment the corresponding metrics. |
| Current room status counts | VERIFIED | READY and MAINTENANCE fixture deltas appear; HIDDEN inventory is excluded from the room count query. |
| Reserved/blocked room nights | VERIFIED | RESERVED calendar for a non-cancelled Booking counts; BLOCKED calendar on an operational room reduces available room-nights; HIDDEN blocked inventory is excluded. |
| Empty-range/zero normalization | VERIFIED / COVERED_BY_UNIT | Unit tests cover empty SQL rows and null-to-zero normalization. |
| Historical inventory semantics | NEEDS_DECISION | Room status counts use current `rooms.status`; occupancy denominator uses current non-HIDDEN rooms. The repository has no room-status history/snapshot model, so historical occupancy cannot be asserted as temporal truth. |
| MAINTENANCE denominator | NEEDS_DECISION | SQL defines operational rooms as `status <> 'HIDDEN'`, therefore MAINTENANCE, CLEANING and OCCUPIED are included in capacity. Product must decide whether “capacity” means physical, sellable or operational inventory. |
| Gross/net/cash-flow semantics | NEEDS_DECISION | `revenue.total` is gross SUCCESS by `paid_at`; refunds are a separate `totalRefunded` metric by `refunded_at`. A paid period followed by a later refund changes neither historical gross nor a computed net because no net field exists. |
| Six-query consistency | NEEDS_DECISION | `Promise.all` issues six independent reads without a shared transaction/snapshot. The response is internally shaped, but cross-metric point-in-time consistency is not guaranteed under concurrent mutations. |

## 3. SQL and architecture review

- The controller is intentionally thin (41 lines) and delegates all date
  validation/aggregation to a single query capability service (281 lines).
- `DashboardQueryService` is a read model/query-service pattern: no entity
  mutation, no authorization logic, and no HTTP envelope construction.
- Date filtering consistently converts local Vietnam calendar boundaries to UTC
  half-open intervals (`>= from`, `< day after to`). Calendar stay dates use an
  inclusive `BETWEEN`, which matches the one-night fixture and the documented
  inclusive range.
- The report’s “gross collected” wording matches the response DTO and SQL. It
  must not be re-labelled net revenue without a product decision.
- No dead route, duplicate controller, or unnecessary file was found in this
  module. The open design questions are semantic/data-model limits, not a
  design-pattern violation.

## 4. Verification commands

| Command | Result |
|---|---|
| `npx jest --config ./test/jest-e2e.json --runInBand test/dashboard-workflow.e2e-spec.ts` | PASS, 1 suite / 2 tests |
| `npx jest src/module/dashboard --coverage --runInBand` | PASS, 1 suite / 6 tests; 98% statements, 86.36% branches |
| `npm run test:e2e -- --runInBand` | PASS in final integration: 20 suites / 98 tests |
| `npm run test -- --runInBand` | PASS in final integration: 42 suites / 302 tests |
| `npm run lint` | PASS in final integration |

## 5. Lượt 9 conclusion

Status: **PASS for implemented local Dashboard workflows and +07 date
boundaries; no production defect proven in this slice. Historical inventory,
capacity denominator, gross/net semantics and read-snapshot consistency remain
NEEDS_DECISION and must not be silently “fixed” in SQL.**

Proceed to Lượt 10 (Common HTTP, authorization and OpenAPI contract), then
carry these reporting decisions to the architecture/final integration gate.
