# Lượt 7C - Booking architecture gate

Date: 2026-08-01  
Scope: capability ownership, transaction boundaries, service size, branch
coverage, query/read separation, and batch behavior after the Booking split.

## 1. Ownership and boundary matrix

| Capability | Owner | Transaction | Finding |
|---|---|---|---|
| Customer/management list/detail | `BookingQueryService` | None (read-only) | Correct separation; controller calls stable `BookingService` facade. |
| Online/counter creation | `BookingCreationService` | One transaction covering Customer resolution, Room lock, Booking save, and RESERVED calendar insert | Correct atomic boundary; validation that does not need DB runs before opening the transaction. |
| Status/cancel/check-in/check-out | `BookingLifecycleService` | One transaction covering Booking, Payment cleanup, Room lock/update, and calendar release | Correct state-machine owner; no transaction is opened by the facade. |
| Expiration scheduler | `BookingExpirationService` | Scheduler adapter delegates to `BookingService`; lifecycle owns the transaction/batch | No duplicated business rule in cron adapter. |
| Room occupancy | Booking lifecycle changes Room on check-in/out; Room mutation endpoint also changes Room status | Separate transactions/capabilities | Cross-module owner remains unresolved: direct Room status can conflict with a CHECKED_IN Booking (WF-RISK-001). |
| Payment state | Lifecycle only fails pending VNPay rows on cancel/expiry; Payment services own collection/manual/refund state | Separate Payment transactions | Coupling is explicit and carried to Lượt 8; no payment mutation was moved here. |

## 2. Size and coverage evidence

Current source line counts (PowerShell `Measure-Object -Line`):

| File | Lines | Branch coverage from `npx jest src/module/booking --coverage --runInBand` |
|---|---:|---:|
| `booking.service.ts` (facade) | 86 | 76.92% |
| `booking-query.service.ts` | 226 | 72.50% |
| `booking-creation.service.ts` | 502 | 62.50% |
| `booking-lifecycle.service.ts` | 345 | 76.09% |
| `booking-expiration.service.ts` | 51 | 75.00% |

Creation is below the aspirational 70% branch target because remaining paths
are mainly validation, duplicate/error mapping, and management contact edge
cases. It is not treated as a green gate solely from statement coverage;
these gaps are carried to the module coverage backlog.

The direct Booking run executed 3 suites / 32 tests. All lifecycle and query
capabilities have direct unit tests plus MySQL workflow evidence; controllers
remain HTTP adapters and are exercised by the E2E route suites.

## 3. Design-pattern assessment

- **Facade/delegation:** `BookingService` is a stable facade with no business
  transaction logic; controllers and public routes remain unchanged.
- **Capability services:** Query, Creation, Lifecycle, and scheduler adapter
  are cohesive and below the 800-line ceiling. No duplicate helper or dead
  split file was introduced in this gate.
- **Unit-of-work/transaction boundary:** TypeORM transactions are opened by
  the capability that owns the mutation, not by controllers or the facade.
- **State-machine guard:** `MANAGEMENT_STATUS_TRANSITIONS` is an enum-keyed
  transition table; invalid transitions and payment/date/Room preconditions
  are rejected in one service.
- **Persistence safety:** pessimistic Booking/Room locks and unique calendar
  keys protect overlap and lifecycle races.

The remaining design risk is not a pattern violation but ownership ambiguity:
Room status has both a direct management mutation path and a Booking lifecycle
path. The confirmed occupancy finding is intentionally not “fixed” by adding a
second hidden rule until the product owner chooses the canonical transition
owner.

## 4. Verification commands

| Command | Result |
|---|---|
| `npx jest src/module/booking --coverage --runInBand` | PASS, 3 suites / 32 tests; capability coverage captured above |
| `npm run test:e2e -- --runInBand` | PASS, 14 suites / 82 tests |
| `npm run test -- --runInBand` | PASS, 42 suites / 302 tests |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run openapi:validate` | PASS; snapshot current |
| `npm run data:audit` | PASS, 10/10 invariants with 0 violations |

## 5. Lượt 7C conclusion

Status: **PASS for Booking architecture and transaction ownership; PARTIAL for
creation branch coverage and cross-module Room occupancy ownership**.

No production refactor is required in this gate. Proceed to Payment Lượt 8A
with the facade/capability boundary intact and carry WF-RISK-001 as a tracked
decision instead of duplicating state rules.
