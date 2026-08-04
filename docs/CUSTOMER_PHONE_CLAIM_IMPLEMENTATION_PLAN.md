# Customer Phone Claim and OTP Implementation Plan

Date: 2026-08-02  
Status: Lượt 1 business rules approved as the implementation baseline  
Scope: counter-created Customers, public Customer activation, phone ownership
verification, Staff invitation, and eventual OTP-gated public registration.

## 1. Repository evidence and current workflow

The counter workflow is already phone-first:

- `CreateManagementBookingDto` permits an existing `customerId`; otherwise the
  booking workflow requires `contactName` and `contactPhone`.
- `BookingCreationService.resolveCounterCustomer()` normalizes and searches by
  Vietnamese phone variants. It reuses an active Customer when found.
- If no Customer exists, the same booking transaction creates an `ACTIVE`
  Customer with `passwordHash = null`, then persists the Booking and calendar
  ownership under that Customer ID.
- `contactEmail` is optional and is not required to serve a counter guest.
- `AuthService.registerCustomer()` rejects an existing email or phone.
- `AuthService.loginCustomer()` deliberately returns the generic `401` contract
  for a Customer whose password is null.
- The only current recovery path is the management-only
  `PATCH /api/v1/management/customers/:id/initial-password`, which lets
  ADMIN/STAFF choose the Customer's first password.

This produces the proven gap: a legitimate counter guest owns bookings under an
existing Customer ID but cannot safely claim that identity through the public
application.

## 2. Approved counter business rules

### 2.1 Information collected by Staff

Required:

1. Customer full name.
2. Vietnamese phone number.
3. Booking contact and stay information already required by the Booking module.

Optional:

1. Email, only when voluntarily provided.
2. Customer note through the existing Booking note field.

Not part of this implementation:

1. Citizen ID/passport persistence.
2. Date of birth or address persistence.
3. Making email mandatory.

Those fields require separate privacy, retention, authorization, and migration
decisions and must not be added as an incidental part of account activation.

### 2.2 Customer matching and profile ownership

1. Canonical Vietnamese phone is the Customer identity key for this workflow.
2. Staff creation continues to reuse an existing non-deleted Customer by phone.
3. A counter booking must never overwrite the existing Customer's master name,
   email, phone, password, or activation evidence merely because Staff entered
   different contact data.
4. Booking contact fields remain a booking-time snapshot.
5. An email already owned by a different Customer remains a conflict; records
   must not be merged automatically.
6. Customer merge, phone replacement, and soft-delete restoration are separate
   ADMIN workflows and are out of scope.

### 2.3 Activation is optional at the counter

1. A Customer does not need an online account to receive counter service.
2. Staff must not ask the Customer to disclose or choose a password.
3. Staff may ask for consent to send an activation SMS.
4. No activation SMS is sent automatically for every booking. This avoids
   unexpected messages, duplicate sends, and unnecessary provider cost.
5. A Customer may initiate activation later from the public application without
   returning to the property.

## 3. Approved account-state policy

The existing account `status` remains responsible for operational access:
`ACTIVE` or `LOCKED`. Credential capability remains separate.

| Customer state | Public claim decision | Result |
|---|---|---|
| Active, non-deleted, password is null | Eligible | Verify phone OTP, then set first password on the same Customer ID |
| Active, non-deleted, password exists | Not eligible for claim | Direct to login or a future password-reset flow |
| Locked | Not eligible | Return the same public neutral response; Staff/Admin support is required |
| Soft-deleted | Not eligible | Do not restore or send an OTP automatically |
| Missing phone | No account result is disclosed | Return the same neutral request response |
| Malformed phone | Invalid request | Return structured `400` field validation |

Knowledge of a name, email, booking code, stay date, or room number is not a
substitute for phone ownership. These are weak or discoverable attributes and
must not unlock claim completion.

## 4. Approved Customer activation journey

1. Customer enters a Vietnamese phone number.
2. Backend normalizes it and applies phone/IP rate limits.
3. Public response remains neutral regardless of account existence or
   eligibility.
4. If eligible, Backend creates one active `CLAIM_ACCOUNT` OTP challenge and
   sends the OTP by SMS.
5. Customer submits `challengeId` and OTP.
6. Backend atomically checks challenge purpose, hash, expiry, attempt count,
   status, and phone snapshot.
7. Successful verification returns a short-lived, single-purpose claim token.
8. Customer submits the claim token and a new password.
9. Backend locks the Customer row, rechecks eligibility, stores a scrypt hash,
   records phone verification, increments `tokenVersion`, and consumes the
   challenge in one transaction.
10. Backend returns a normal Customer access token and the Customer is signed in
    immediately.
11. Existing counter Bookings become visible naturally because the Customer ID
    never changes.

Automatic login after completion is approved because possession of the phone
and the newly established password have both been proven. The claim token is not
an access token and cannot call Customer or Booking endpoints.

## 5. Approved OTP baseline

| Control | Baseline |
|---|---|
| Channel | SMS to the canonical Customer phone |
| OTP format | Six numeric digits generated with a cryptographically secure RNG |
| OTP storage | Hash only; never plaintext |
| OTP lifetime | 5 minutes |
| Verification attempts | Maximum 5 per challenge |
| Resend cooldown | 60 seconds |
| Phone send limit | 3 per 15 minutes and 10 per 24 hours |
| IP request limit | 20 per 15 minutes, subject to trusted-proxy deployment policy |
| Active challenge | A new OTP invalidates all older pending OTPs for the same phone and purpose |
| Claim token lifetime | 10 minutes |
| Replay | Verified challenge and claim token are single-use |
| Logging | No OTP, password, claim token, or complete phone number in logs |

Provider delivery failure must not create a verified challenge. Ambiguous
provider timeouts are recorded for operational review and must not be treated as
successful verification.

## 6. Approved public-response policy

The request-OTP endpoint uses the same external success envelope for:

- eligible passwordless Customer;
- missing Customer;
- Customer with an existing password;
- locked or deleted Customer.

Recommended message:

`Neu so dien thoai du dieu kien, ma xac minh se duoc gui.`

The Backend may log a safe internal reason category without recording the full
phone. Malformed input remains a `400`, and rate limiting remains a `429` with
`Retry-After`.

OTP verification and completion may return specific challenge-state error codes
that do not disclose another Customer's profile, including expired, invalid,
attempts-exceeded, already-consumed, and invalid-claim-token.

## 7. Staff workflow decision

The Staff Customer/Booking screen will eventually expose:

- `canInviteClaim`;
- a safe reason code when invitation is unavailable;
- `phoneVerifiedAt` where the Staff role is authorized to view it;
- a `Send activation instructions` action gated by Customer consent.

The action requests provider delivery but never returns the OTP. Staff cannot
verify the challenge for the Customer.

The current initial-password endpoint follows this rollout policy:

1. Keep it operational while OTP is being implemented so existing counter
   service is not broken.
2. Remove it from the normal Staff UI when claim reaches production.
3. Restrict it to ADMIN break-glass support after one stable release.
4. Remove it only after production evidence shows no remaining operational
   dependency and all passwordless legacy Customers have a supported path.

## 8. Public registration convergence

Claim and new registration must converge on verified phone ownership.

For a new phone:

1. Collect full name, phone, optional email, and password in a pending
   registration request.
2. Verify the phone before creating an active Customer.
3. Recheck canonical phone uniqueness inside the completion transaction.

For a phone that becomes a counter Customer while registration is pending:

1. Completion re-reads the Customer by canonical phone under a lock.
2. If that Customer is active and passwordless, the verified flow claims the
   existing Customer instead of creating a duplicate.
3. If a password was configured concurrently, completion stops and directs the
   user to login/password recovery.

No public route may replace the password of an already configured Customer based
only on knowledge of the phone number.

## 9. Delivery rounds

### Lượt 1 - Business analysis and decisions

Status: COMPLETE in this document.

Exit criteria:

- phone-first counter identity approved;
- email remains optional;
- no Staff-managed Customer password in the target workflow;
- self-service SMS claim approved;
- OTP baseline and response-enumeration policy recorded;
- rollout boundary for the legacy initial-password endpoint recorded.

### Lượt 2 - Persistence and state machine

Status: COMPLETE on 2026-08-02. Detailed evidence is recorded in
`docs/audit/workflows/14-customer-phone-claim-persistence-verification.md`.

- add the OTP challenge entity and migration;
- add Customer phone-verification evidence;
- define enums and transition policy;
- implement transactional repositories and concurrency tests;
- do not call an external SMS provider yet.

### Lượt 3 - SMS adapter

Status: COMPLETE on 2026-08-02 for the provider-neutral boundary, deterministic
test adapter, OTP configuration, and fail-closed runtime policy. A real provider
remains `BLOCKED_EXTERNAL` until a vendor and credentials are approved. Detailed
evidence is recorded in
`docs/audit/workflows/15-customer-phone-claim-sms-adapter-verification.md`.

- add a provider-neutral delivery interface;
- add a deterministic test adapter for unit/E2E only;
- add environment validation and fail-closed production configuration;
- select and integrate the real provider only through the adapter.

### Lượt 4 - Public claim API

Status: DEFERRED by product decision on 2026-08-02 until deployment/provider
work resumes. Local development uses the guarded passwordless-Customer bridge
documented in
`docs/audit/workflows/16-local-auth-passwordless-claim-verification.md`.

- request, verify, and complete endpoints;
- OTP hashing, expiry, attempt, resend, replay, and rate-limit controls;
- generic request response and structured safe verification errors;
- unit, authorization, and MySQL E2E coverage.

### Lượt 5 - Staff integration

- capability fields and consent-aware invitation endpoint;
- Staff/Admin authorization coverage;
- begin deprecation of the initial-password UI path.

### Lượt 6 - OTP-gated public registration

- stop creating a new active Customer before phone verification;
- handle online-registration/counter-creation races;
- preserve existing public login behavior.

### Lượt 7 - FE contract handoff

- regenerate OpenAPI;
- document Customer activation, registration, resend, error, and countdown UI;
- document Staff invitation and capability UI;
- no simulated production OTP success in FE.

### Lượt 8 - Verification and rollout

- full unit and serial MySQL E2E;
- data audit and schema-drift check;
- security scan for enumeration, replay, brute force, token leakage, and account
  takeover;
- feature-flagged rollout and operational metrics;
- restrict/remove legacy initial-password only after the rollout gate passes.

## 10. Lượt 1 non-goals and remaining implementation choices

No route, entity, migration, or runtime behavior is changed in Lượt 1.

The SMS vendor is intentionally not selected here. Vendor selection belongs to
Lượt 3 and must consider Vietnamese delivery support, sender registration,
delivery receipts, cost, data processing terms, and sandbox availability. The
business contract and provider interface must remain vendor-neutral.
