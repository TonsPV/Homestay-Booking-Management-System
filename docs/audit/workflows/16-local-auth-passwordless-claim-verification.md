# Local Auth Passwordless Customer Claim Verification

Date: 2026-08-02  
Status: COMPLETE for local development; explicitly forbidden in production.

## Problem fixed

A Staff counter booking can create an active Customer with no password. The
normal registration route then saw the phone as duplicate and returned `409`,
while login returned the generic `401` because no password existed.

## Guarded local behavior

When all conditions below are true, the existing registration route sets the
first password on the original Customer ID:

1. `CUSTOMER_CLAIM_LOCAL_BYPASS_ENABLED=true`;
2. `NODE_ENV` is explicitly `development` or `test`;
3. canonical phone matches an active, non-deleted Customer;
4. that Customer's password is null;
5. supplied email does not conflict with the Customer profile or another
   Customer.

The transaction reloads the Customer including the hidden password under a
pessimistic write lock. It stores the already-scrypt-hashed password, increments
`tokenVersion`, and fills email only when the counter profile had no email.

It deliberately does not:

- replace an existing password;
- overwrite the Staff-recorded full name;
- merge two Customers;
- restore deleted or unlock locked Customers;
- set `phoneVerifiedAt` without OTP evidence;
- create fake OTP/SMS evidence.

The normal login route is unchanged. It succeeds after the first password is
stored because it reads the same Customer ID and scrypt hash.

## Production containment

Environment validation refuses the bypass unless `NODE_ENV` is explicitly
`development` or `test`. The default is false, `.env.example` labels it
local-only, and no production fallback exists. OTP challenge and SMS provider
foundations from Lượt 2/3 remain intact for the future production flow.

## Verification

| Check | Result |
|---|---|
| Build | PASS |
| Hotfix lint | PASS |
| Environment/Auth/local-claim unit tests | PASS, 3 suites / 32 tests |
| Dedicated Auth + local-claim E2E | PASS, 2 suites / 6 tests |
| Full MySQL E2E | PASS, 22 suites / 102 tests |
| Local `hbms` migrations | PASS, 15/15 applied |
| Local schema drift | PASS |
| Local data audit | PASS, 12/12 with zero violations |

The dedicated E2E proves registration then immediate login for a passwordless
counter Customer, preserves the original full name and unverified phone state,
and proves a configured Customer keeps the old password while a duplicate
registration receives `409`.

## Local operation

The local `.env` now contains:

```env
NODE_ENV=development
CUSTOMER_CLAIM_LOCAL_BYPASS_ENABLED=true
```

Restart the NestJS process after pulling the change. Production deployment must
set the bypass to false or omit it entirely.

