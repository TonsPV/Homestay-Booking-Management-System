# Lượt 2 - User workflow verification

Date: 2026-08-01  
Scope: `src/module/user`, ADMIN-only user routes, account status/token-version
transitions, and concurrent update behavior. No migration or DB column change was
needed.

## 1. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| Anonymous access | VERIFIED | `GET /api/v1/users` returns `401`. |
| Customer access | VERIFIED | A real customer bearer token receives `403`. |
| ADMIN create | VERIFIED | Valid input creates `ACTIVE` `STAFF`; ADMIN issuance is rejected with `400`. |
| Create normalization | VERIFIED | Names, email, and phone are normalized before persistence. |
| Response projection | VERIFIED | Create/list/update responses omit `passwordHash`, `tokenVersion`, and `deletedAt`. |
| Search/filter/pagination | VERIFIED | Search, `role`, `status`, page/limit, and pagination metadata are checked against MySQL state. |
| Update profile/contact/password | VERIFIED | Full name, email, phone, and password update; password reset increments `tokenVersion`. |
| Empty update and ADMIN promotion | VERIFIED | Empty body and `role: ADMIN` both return `400`; no persistence is performed. |
| Password-reset revocation | VERIFIED | The pre-reset STAFF token returns `401`; a token signed with the current DB version can access management routes. |
| Lock/unlock | VERIFIED | Lock increments version and a matching-version locked token returns `403`; unlock increments again and stale tokens return `401`. |
| Idempotent status request | VERIFIED | Repeating `ACTIVE` does not increment `tokenVersion`. |
| ADMIN self-demotion/self-lock | VERIFIED | Both operations return `400`. |
| Duplicate email/phone | VERIFIED | API returns `409` for each duplicate identifier. |
| Duplicate create race | VERIFIED | Two concurrent POST requests produce one `201` and one `409`; one row remains. |
| Concurrent password + status mutation | VERIFIED after fix | The pre-fix characterization ended `ACTIVE` after a concurrent lock/password request, losing the lock. The service now serializes both updates; the E2E assertion ends `LOCKED` with `tokenVersion = 2`. |

## 2. Evidence-backed fix

### USER-DEFECT-001 - lost update between password and status changes

Initial characterization used two concurrent requests against one STAFF row:

```text
PATCH /api/v1/users/:id/status { status: "LOCKED" }
PATCH /api/v1/users/:id       { password: "ConcurrentPassword456!" }
```

Both requests returned `200`, but before the fix the final database row was
`ACTIVE`, proving that one mutation overwrote the other. This was a real business
state defect, not a test-only ordering problem.

Fix applied in `src/module/user/user-admin.service.ts`:

1. `updateUser` and `updateStatus` now run through a shared TypeORM transaction.
2. The transaction reads the target row with `pessimistic_write` locking.
3. The unit-test repository mock keeps a safe non-transaction fallback, while the
   real TypeORM repository uses the transactional manager.

The same E2E characterization now verifies both side effects and the monotonic
token-version result.

## 3. Commands and regression result

| Command | Result |
|---|---|
| `npx jest --config ./test/jest-e2e.json --runInBand test/user-workflow.e2e-spec.ts` | PASS, 1 suite / 5 tests |
| `npm run test:e2e -- --runInBand` | PASS on rerun, 5 suites / 50 tests |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm test -- --runInBand` | PASS, 42 suites / 302 tests |

The first full-E2E attempt had one failure in the pre-existing Room Image concurrent
cover test (`updatedImages` temporarily showed zero covers); an immediate rerun
passed all 50 tests. This is recorded as a flaky characterization for the later
Room/Image round, not attributed to the User transaction change.

## 4. Architecture and design-pattern check

- `UserAdminController` remains an HTTP/authorization mapper; ADMIN policy and
  normalization stay in `UserAdminService`.
- Existing `AccessTokenGuard`, `RolesGuard`, `@Roles('ADMIN')`, DTOs, and response
  envelope are reused.
- The transaction/row-lock seam is local to the two mutating methods and keeps
  the public controller behavior and response shape unchanged.
- No User-specific file was proven to be junk or safely removable. The service is
  larger than a trivial CRUD class because it owns normalization, uniqueness,
  self-protection, status state transitions, and token revocation.

## 5. Remaining risks

| Item | Status | Reason |
|---|---|---|
| Multi-replica rate limiting | GAP_EVIDENCE | Shared process-local limiter remains a Common HTTP/deployment concern. |
| Production migration | NOT_REQUIRED | Transaction fix changes no schema. |
| Cross-module stale references | NOT_RUN | Covered in later Customer/Booking rounds; this suite only owns User fixtures. |

## 6. Lượt 2 conclusion

Status: **PASS after USER-DEFECT-001 fix**.

The User workflows in the proposal now have direct unit and standalone MySQL E2E
evidence, including the previously missing concurrent password/status invariant.
Proceed to Lượt 3 (Customer) without carrying the lost-update defect forward.
