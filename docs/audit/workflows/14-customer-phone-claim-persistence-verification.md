# Customer Phone Claim - Lượt 2 Persistence Verification

Date: 2026-08-02  
Scope: persistence, state policy, transactional challenge creation, migration,
and data invariants. No public claim route or SMS provider was added.

## 1. Implemented persistence

- Added nullable `customers.phone_verified_at` as explicit phone-ownership
  evidence. Existing Customers remain null; the migration does not invent
  historical verification.
- Added `customer_claim_challenges` with a random UUID identifier, Customer FK,
  canonical phone snapshot, hidden OTP/claim-token hashes, purpose, state,
  attempt counter, expiry, verification, consumption, and audit timestamps.
- Added indexes for Customer/purpose/status locking and lookup, phone/purpose
  send-window queries, and status/expiry maintenance.
- Added migration `AddCustomerPhoneClaim1784784000000` with executable `up` and
  `down`, and registered it in the runtime data source and migration contract.

Challenge states are enum-owned:

- `PENDING`
- `VERIFIED`
- `CONSUMED`
- `EXPIRED`
- `BLOCKED`

The current purpose is `CLAIM_ACCOUNT`. Registration-specific behavior remains
deferred to Lượt 6 rather than overloading the first state machine.

## 2. Policy and transaction behavior

`CustomerClaimPolicy` now characterizes:

- missing/soft-deleted Customer;
- locked Customer;
- Customer whose password is already configured;
- eligible active passwordless Customer;
- failed-attempt blocking;
- OTP expiry;
- verification evidence;
- claim-token expiry;
- single-use consumption and replay rejection.

`CustomerClaimChallengeService.createPendingChallenge()`:

1. validates the internal Customer ID, canonical phone snapshot, hash boundary,
   and future expiry;
2. starts a TypeORM transaction;
3. reloads the non-deleted Customer including its hidden password hash under a
   pessimistic write lock;
4. rechecks claim eligibility and exact canonical phone ownership;
5. expires every older pending challenge for that Customer/purpose;
6. inserts the new pending challenge in the same transaction.

This serialization is the persistence boundary required before Lượt 3/4 add
delivery and public HTTP behavior. It prevents two concurrent requests from
leaving two usable pending OTPs.

## 3. Data-audit additions

Two read-only checks were added:

- `customer-claim-single-pending`: at most one pending challenge for each
  Customer/purpose;
- `customer-claim-state`: verification/token/consumption evidence agrees with
  the challenge state.

Both checks return zero violations on the test database.

## 4. Verification evidence

| Check | Result |
|---|---|
| Build | PASS |
| Lint for all Lượt 2 files | PASS |
| Claim policy + migration contract + data-audit unit tests | PASS, 3 suites / 29 tests |
| Dedicated MySQL persistence E2E | PASS, 1 suite / 2 tests |
| Full MySQL E2E | PASS, 21 suites / 100 tests |
| Test migration | PASS, 15/15 applied |
| Test schema drift | PASS, entity metadata matches MySQL |
| Test data audit | PASS, 12/12 with zero violations |

The concurrency E2E starts two challenge-creation transactions for one
passwordless Customer. Both requests complete, but MySQL contains exactly one
`PENDING` and one invalidated `EXPIRED` challenge. Configured and locked
Customers produce no challenge rows.

## 5. Known unrelated repository gate

The full unit command reports 43 suites / 323 tests passing and one pre-existing
OpenAPI contract failure. `ErrorEnvelopeDto.details` currently generates
`additionalProperties: false`, while
`src/openapi/openapi-contract.spec.ts` still expects `true`. This mismatch was
already present before Lượt 2 and no unrelated contract/test was changed merely
to make this round green.

## 6. Boundaries retained for Lượt 3/4

- No OTP generation or comparison exists yet.
- No SMS provider or fake production delivery exists.
- No public request/verify/complete route exists.
- No Customer password is set by the new service.
- The legacy management initial-password route remains unchanged.
- The non-test/default database was not migrated; only the guarded `_test`
  database was changed.

Lượt 3 can now introduce a provider-neutral SMS delivery boundary without
changing the persistence contract proven here.

