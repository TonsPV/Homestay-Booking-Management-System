# Lượt 3 - Customer workflow verification

Date: 2026-08-01  
Scope: customer profile, password lifecycle, ADMIN/STAFF customer management,
status/token-version transitions, and concurrent mutation behavior.

## 1. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| Customer profile ownership | VERIFIED | Customer token reads/updates only `/customers/me`; a STAFF token receives `403`. |
| Profile normalization | VERIFIED | Name, email, and Vietnamese phone are normalized before update. |
| Duplicate profile contact | VERIFIED | Existing email/phone returns `409`; response stays in the shared envelope. |
| Empty profile update | VERIFIED | Empty body returns `400`. |
| Profile projection | VERIFIED | Public profile response contains allowlisted fields only. |
| Change own password | VERIFIED | Current password is checked, new password must differ, scrypt hash is replaced, and token version increments. |
| Password token revocation | VERIFIED | Old token returns `401`; a token signed with the current DB version reads the profile. |
| Locked password change | VERIFIED | Locked account is rejected with `403`. |
| Initial password | VERIFIED | STAFF/ADMIN can configure a passwordless customer once; a customer token is denied and a second attempt returns `409`. |
| Concurrent initial password | VERIFIED | Pessimistic lock produces exactly one `200` and one `409`. |
| ADMIN customer list | VERIFIED | Anonymous/STAFF are denied; ADMIN search/status/pagination and projection are checked against MySQL. |
| Customer status transitions | VERIFIED | LOCK/UNLOCK increment token version; matching-version locked token is `403`, stale tokens are `401`, and idempotent ACTIVE does not increment. |
| Invalid/missing management ID | VERIFIED | Invalid ID returns `400`; missing numeric ID returns `404`. |
| Concurrent profile/profile update | CHARACTERIZED | Both requests can return `200`; the final name is one writer's value (last-write-wins). This is current behavior, not reported as a defect without a product rule requiring rejection/versioning. |
| Concurrent ADMIN lock + customer password change | VERIFIED after fix | The pre-fix run ended `LOCKED` with `tokenVersion=1` after two successful mutations. The service now preserves both side effects and ends `LOCKED` with `tokenVersion=2`. |

## 2. Evidence-backed fix

### CUSTOMER-DEFECT-001 - lost token-version update in status/password race

The live characterization ran these requests concurrently for one ACTIVE customer:

```text
PATCH /api/v1/customers/:id/status { status: "LOCKED" }
PATCH /api/v1/customers/me/password { currentPassword, newPassword }
```

Before the fix both requests returned `200`, but the final row had
`status=LOCKED` and `tokenVersion=1`; one version increment was lost.

`src/module/customer/customer-admin.service.ts` now uses a TypeORM transaction
with a `pessimistic_write` row lock for status mutation. The public route and
response shape are unchanged, and the service's unit-test repository fallback
remains compatible with existing mocks. The E2E race now verifies
`status=LOCKED`, `tokenVersion=2`.

## 3. Commands

| Command | Result |
|---|---|
| `npx jest --config ./test/jest-e2e.json --runInBand test/customer-workflow.e2e-spec.ts` | PASS, 1 suite / 4 tests |
| `npm run test:e2e -- --runInBand` | PASS, 6 suites / 54 tests |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm test -- --runInBand` | PASS, 42 suites / 302 tests |

The full MySQL E2E gate includes the Auth, User, Customer, original application,
and health suites. The deliberate VNPay timeout log remains a passing fixture.

## 4. Architecture and design-pattern check

- Profile, credential, and admin concerns remain separate services; controllers
  only map actor/role guards, DTOs, and envelopes.
- Existing `AccessTokenGuard`, `ActorsGuard`, `RolesGuard`, and `@Actors/@Roles`
  metadata are reused.
- Password and initial-password flows already used transaction + pessimistic lock;
  the status service now follows the same concurrency pattern.
- No customer file was proven to be safe junk or a duplicate. The remaining
  profile/profile last-write-wins behavior needs an explicit product policy before
  introducing optimistic versioning or rejecting concurrent edits.

## 5. Lượt 3 conclusion

Status: **PASS after CUSTOMER-DEFECT-001 fix; profile/profile concurrency is
characterized but policy-dependent**.

Customer profile, credential, management, ownership, projection, and state-machine
flows now have direct unit and standalone MySQL E2E evidence. Proceed to Lượt 4
(Amenity), while carrying the room-image flaky E2E characterization from the full
gate to its later Room/Image round.
