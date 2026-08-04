# Lượt 13 - Architecture, hygiene, CI và release verification

Date: 2026-08-01  
Scope: Final static graph, aggregate ownership, service size/design patterns,
file hygiene, CI definition and release blockers.

## 1. Final static architecture scan

An AST import scan was rerun against the current `src` and operational
`scripts` snapshot, with application/module, data-source, database maintenance
and seed entry points as roots:

| Metric | Result |
|---|---:|
| Production/script TypeScript files | 176 |
| Runtime relative-import edges | 483 |
| Type-only edges | 71 |
| Runtime circular dependencies | 0 |
| Unreachable production/script source | 0 |

The scan includes the new workflow/report support and the payment fix. The
deleted Nest starter files remain intentionally deleted; they are not
unreachable source because they are no longer part of the runtime snapshot.

## 2. Aggregate ownership and design patterns

| Concern | Current owner/pattern | Assessment |
|---|---|---|
| Booking creation/query/lifecycle | `BookingService` facade over Creation/Query/Lifecycle capabilities; lifecycle owns Booking/Room/Calendar transaction | PASS; stable facade + capability services |
| Room catalog/mutation/image/calendar reads | Room facade over Query/Mutation/Availability/Image services | PASS; direct Room status still crosses the Booking occupancy invariant (WF-RISK-001) |
| Payment collection/manual/refund/query | Payment facade over Collection/Manual/Refund/Query capabilities | PASS; VNPay is an adapter/gateway boundary and refunds use two-phase prepare/external/apply |
| State transitions | Enum-backed transition maps and explicit guards in Booking/Payment/Room | PASS; no speculative class-per-state abstraction was introduced |
| HTTP boundary | Guards/decorators, interceptor/filter, response envelope | PASS; shared cross-cutting pattern |
| Persistence | TypeORM repositories + explicit transactions/pessimistic locks where mutations are atomic | PASS for exercised flows |
| Scheduler | Thin cron adapters with `waitForCompletion` | PARTIAL for multi-replica deployment; no distributed lock |
| Rate limiting/storage | In-memory process-local bucket and local managed image storage | PARTIAL before horizontal scaling; deployment decision required |

Current service sizes (PowerShell line count):

| Service | Lines | Conclusion |
|---|---:|---|
| PaymentRefundService | 654 | One coherent refund/reconciliation capability; increase failure-matrix coverage before another split |
| PaymentCollectionService | 513 | One coherent VNPay collection/callback capability |
| BookingCreationService | 502 | One atomic creation transaction capability |
| RoomQueryService | 466 | One read/search capability |
| BookingLifecycleService | 345 | One state-machine/cleanup capability |
| RoomMutationService | 328 | One mutation/status/history capability |
| DashboardQueryService | 281 | One read-model query capability |

No generic repository/mediator/event-bus layer is missing from the current
design; adding one only to satisfy a pattern label would increase complexity.

## 3. Hygiene and repository state

- Generated/runtime directories (`dist`, `coverage`, `.data`, `.tmp`,
  `node_modules`) are ignored and were not deleted to make the audit look clean.
- Static reachability/compiler/tests find no dead production/script file. Audit
  reports, workflow tests and migration scripts are untracked because this
  worktree has not been committed; that is repository state, not evidence that
  they are junk.
- `git diff --check` reports no whitespace errors (only the repository’s normal
  LF/CRLF conversion warnings).
- A clean-checkout rebuild was **NOT_RUN**: the user’s worktree contains broad
  pre-existing modifications and new audit artifacts, and no commit/branch was
  authorized in this request. Release reproducibility therefore remains
  blocked until the reviewed changes are committed and rerun from a clean
  checkout.

## 4. CI and release evidence

Added `.github/workflows/ci.yml` with:

- locked `npm ci` on Node 22;
- MySQL 8.4 service using an `_test` database;
- lint, build, migrations, schema drift, data audit, OpenAPI validation, unit
  and serial MySQL E2E gates;
- production dependency audit (`npm audit --omit=dev --audit-level=high`).

The workflow is defined but has not executed in GitHub from this uncommitted
worktree. Local equivalents currently report:

| Gate | Result |
|---|---|
| Unit | PASS, 42 suites / 302 tests |
| E2E | PASS, 20 suites / 98 tests |
| Lint/build | PASS |
| OpenAPI | PASS; snapshot current |
| Test migration/schema | PASS, 14/14 applied and no drift |
| Data audit | PASS, 10/10 invariants |
| Production dependency audit | FAIL, 2 High `js-yaml` advisory findings through `@nestjs/swagger`; `npm audit fix --force` proposes a breaking dependency change and was not run |
| Default/non-test DB | BLOCKED, 2 migrations pending / schema drift previously observed; test copy is clean |
| External VNPay sandbox | BLOCKED_EXTERNAL; local signed/mocked adapter only |

## 5. Open findings carried forward

| ID | Severity | Label | Required owner/decision |
|---|---:|---|---|
| WF-RISK-001 | P1 candidate | Room status API can violate CHECKED_IN ↔ OCCUPIED invariant | Product/architecture owner between Room and Booking; do not silently change policy |
| WF-RISK-003 / SEC-008 | P1 security | Registration creates ACTIVE Customer without out-of-band ownership verification | Explicit accepted risk or provider-backed verification scope |
| WF-RISK-004/005/006 | P1/P2 reporting | Gross/net, MAINTENANCE denominator, historical inventory | Product reporting decision or temporal inventory model |
| WF-RISK-009/010 | P2 policy | Early checkout and past-date calendar block | Product policy decision |
| WF-RISK-011 | P2 testing | Payment Collection 53.02% and Refund 56.47% branch coverage, below 70% target | Add provider failure/concurrency matrix before release gate |
| WF-RISK-012 | P2 external | No controlled VNPay sandbox | Provider/infrastructure owner |
| Deployment | P2 | In-memory rate limit, local image storage, process-local scheduler | Choose single-instance deployment or shared store/object storage/distributed lock |

## 6. Lượt 13 conclusion

Status: **Architecture/hygiene PASS for the current modular-monolith design;
release readiness remains PARTIAL/BLOCKED by dependency High, non-test schema
state, clean-checkout/CI execution, external sandbox and recorded business
decisions. No further broad refactor is justified before those owners decide.**
