# Customer Phone Claim - Lượt 3 SMS Adapter Verification

Date: 2026-08-02  
Scope: provider-neutral SMS boundary, deterministic test delivery, OTP runtime
configuration, and production fail-closed policy. No public claim route was
added and no real SMS vendor was called.

## 1. Implemented boundary

`CustomerClaimSmsProvider` defines one delivery contract with typed outcomes:

- `ACCEPTED`: provider accepted the message;
- `REJECTED`: provider definitively rejected or delivery is disabled;
- `UNKNOWN`: timeout/ambiguous provider result that must not be treated as
  verified or successful.

The request contains only canonical phone, SMS text, and a challenge correlation
ID. Provider message IDs and safe internal reason categories are returned
without exposing credentials.

`CustomerClaimSmsService`:

1. fails closed when the feature is disabled;
2. normalizes Vietnamese phone input;
3. requires exactly six OTP digits;
4. validates the internal challenge correlation ID;
5. builds the approved claim-only message with configured expiry;
6. delegates delivery through the abstract provider.

The message contains no booking, room, email, password, or Customer profile
data. No production code logs the OTP or complete phone number.

## 2. Adapters

### Disabled adapter

The default adapter performs no external I/O and returns a typed
`provider_disabled` rejection. This keeps every current environment operational
while public claim routes remain absent.

### Deterministic test adapter

`TestCustomerClaimSmsProvider` is an in-memory test seam that:

- records deliveries in deterministic order;
- generates deterministic test provider IDs;
- queues `ACCEPTED`, `REJECTED`, or `UNKNOWN` outcomes;
- returns copies of recorded messages;
- resets all state between tests.

Environment validation permits this adapter only when `NODE_ENV=test`. It is
not a development or production fallback and does not simulate production
delivery success.

## 3. Runtime configuration

Added validated configuration with Lượt 1 defaults:

| Key | Default |
|---|---:|
| `CUSTOMER_CLAIM_SMS_ENABLED` | `false` |
| `CUSTOMER_CLAIM_SMS_PROVIDER` | `disabled` |
| `CUSTOMER_CLAIM_OTP_LIFETIME_MINUTES` | `5` |
| `CUSTOMER_CLAIM_OTP_MAX_ATTEMPTS` | `5` |
| `CUSTOMER_CLAIM_OTP_RESEND_COOLDOWN_SECONDS` | `60` |
| `CUSTOMER_CLAIM_OTP_RATE_WINDOW_MINUTES` | `15` |
| `CUSTOMER_CLAIM_OTP_PHONE_WINDOW_LIMIT` | `3` |
| `CUSTOMER_CLAIM_OTP_PHONE_DAILY_LIMIT` | `10` |
| `CUSTOMER_CLAIM_OTP_IP_WINDOW_LIMIT` | `20` |
| `CUSTOMER_CLAIM_TOKEN_LIFETIME_MINUTES` | `10` |

The application refuses contradictory or unsafe configuration:

- enabled with `disabled` provider;
- `test` provider outside `NODE_ENV=test`;
- provider selected while the feature is disabled;
- unsupported provider name;
- OTP policy values outside approved bounds.

Because no real provider adapter is installed, production cannot enable claim
SMS yet. This is intentional fail-closed behavior, not a simulated integration.

## 4. Verification evidence

| Check | Result |
|---|---|
| Build | PASS |
| Lint for all Lượt 3 files | PASS |
| Environment + SMS service + test adapter unit tests | PASS, 3 suites / 22 tests |
| Full MySQL E2E regression | PASS, 21 suites / 100 tests |
| Data audit after E2E | PASS, 12/12 with zero violations |

The full E2E output contains the existing intentional VNPay timeout fixtures;
all suites pass and no SMS network operation occurs.

## 5. External blocker and Lượt 4 boundary

Status for real delivery: `BLOCKED_EXTERNAL`.

Required before production enablement:

1. approve an SMS vendor that supports Vietnamese delivery and registered
   sender requirements;
2. approve cost, data-processing terms, credentials, delivery receipt semantics,
   timeout behavior, and sandbox access;
3. implement that vendor behind `CustomerClaimSmsProvider`;
4. add contract tests for accepted, rejected, timeout, and credential failure;
5. keep `CUSTOMER_CLAIM_SMS_ENABLED=false` until those checks pass.

Lượt 4 may now build request/verify/complete APIs using the deterministic test
adapter in guarded tests, but production activation remains disabled until the
external blocker is resolved.

