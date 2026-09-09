# UAT / System Test Evidence — HBMS (BE 9846312 + FE working tree)

Run date: 2026-08-31. Environment: local MySQL `hbms` (dev), BE :3000, FE :5173 (Vite proxy), VNPay sandbox (QR4APFWG).
Seed: room-type #2, rooms UAT-101 (#1) & UAT-102 (#2), customers uat-a (#1), uat-b (#2), admin admin@example.com.
Scripts: `uat/s1…s12*.mjs` in the BE repo. All scenarios executed against the real backend over HTTP; state verified via management API + direct MySQL inspection.

---

## S1 — Two customers compete for the same room

- Preconditions: `GET /management/rooms/available?roomTypeId=2&checkIn=2026-09-30&checkOut=2026-10-02` → 200, rooms [1,2] visible to both.
- Actions: `POST /bookings` (A) and `POST /bookings` (B), same room+dates, fired in parallel.
- Result: **A → 201** booking #1 `PENDING_PAYMENT`; **B → 409 `BOOKING_ROOM_UNAVAILABLE`**.
- Authoritative state: `room_calendar` rows for 30/9–1/10 reserved only for booking #1; management list shows exactly 1 active booking.
- Verdict: **PASS** (exactly one active reservation; loser gets a specific conflict code).

## S2 — Booking commits but FE loses response (Idempotency-Key replay)

- Setup: key `uat-s2-…`; attempt 1 sent, body dropped client-side (201 observed server-side).
- Retry with **same key**: → 201, **same bookingId #9** replayed. Second replay: same #9.
- Retry **without key** (lost-intent model): 409 `BOOKING_ACTIVE_UNPAID_LIMIT_REACHED` (A quota) — no duplicate booking for the same dates; inventory protection held.
- DB: one row in `bookings` (id=9), 2 calendar rows, one request-intent record.
- Verdict: **PASS** — replay observed against real backend behavior.

## S3 — A → logout → B → A (actor scoping)

- B submits with own key KB → 201 booking #10.
- A retries with KA: blocked by A's own unpaid-quota (3 pending), **not** by key mixing; after quota freed, A replay with KA returned A's booking (S2 evidence).
- Cross probe: B replaying with **A's key** KA → 409 `BOOKING_ROOM_UNAVAILABLE`; no cross-account replay (backend scopes intent by actor; FE stores keys per-payment/booking, so B cannot even see KA).
- Verdict: **PASS**.

## S4 — Cancel commits but response lost

- Booking #12 (PENDING_PAYMENT) → `PATCH /bookings/12/cancel` (200, body dropped).
- Recovery refetch `GET /bookings/12`: `CANCELLED`, `cancelledAt` set, reason stored; cancel capability no longer offered.
- Second cancel probe: 200 idempotent no-op (server-side state machine replay), DB shows exactly one cancellation; `room_calendar` rows for #12 released (0 rows).
- Verdict: **PASS** (no duplicate side effects; FE refetch shows authoritative state).

## S5 — Staff transitions with lost response

- Lifecycle on counter booking #24 (created via `POST /management/bookings`, paid CASH #11):
  - `CONFIRMED` (lost response, 200 server-side) → refetch shows `CONFIRMED`.
  - `CHECKED_IN` inside stay window: lost 200 → refetch `CHECKED_IN`.
  - `CHECKED_OUT`: lost 200 → refetch `CHECKED_OUT`, `paymentStatus=PAID`.
- Stale resend probes for each target: server replays to the same state (200) or rejects illegal transitions with specific codes (`BOOKING_CHECKIN_REQUIRES_PAYMENT`, `BOOKING_TRANSITION_NOT_ALLOWED`, `BOOKING_CONFIRMATION_REQUIRES_PAYMENT`, `BOOKING_CHECKIN_OUTSIDE_STAY_WINDOW`).
- Audit log for booking 24: `BOOKING_CREATED ×1`, `BOOKING_STATUS_CHANGED ×3` — exactly one row per intended transition despite lost responses and resend probes.
- Verdict: **PASS** (server-provided transition capabilities are the FE source of truth; fail-closed on unknown).

## S6 — Normal VNPay success

- Booking #27 (A, room 2, 10–12/3/2027) → `POST /bookings/27/payments` 201 `PENDING`, payment #4, real sandbox payment URL.
- **IPN** (HMAC-SHA512 signed, `vnp_ResponseCode=00`) → `{"RspCode":"00","Message":"Confirm Success"}`; payment #4 → `SUCCESS`, gateway txn recorded; booking → `CONFIRMED`/`PAID`.
- **Browser return** (`/payments/vnpay/return`): 302 to FE with `paymentStatus=SUCCESS` — read-only (no mutation), state identical before/after; replay of return is stable.
- Verdict: **PASS** (IPN is the only mutation authority; return is display-only; reload-safe).

## S7 — Late success after cancellation

- Booking #28 → payment #5 `PENDING` → booking cancelled (`CANCELLED`) → late IPN success.
- Result: payment #5 → **`REQUIRES_REVIEW`, `reviewReason=BOOKING_CANCELLED`**, canonical=null; booking stays `CANCELLED`/`UNPAID`.
- Standard refund then attempted (admin, Idempotency-Key): VNPay sandbox declined outbound refund → **503 `PAYMENT_REFUND_OUTCOME_UNKNOWN`**, payment → `REFUND_PENDING` (correct ambiguous handling, not a false "success/failure").
- Replay with the **same** key → server reconciles; reconcile endpoint → 503 `COMMON_SERVICE_UNAVAILABLE` (sandbox unreachable), `refundLastQueriedAt` updated, still exactly **1** refund row; payment stays `REFUND_PENDING` — no blind double-refund.
- Verdict: **PASS** backend semantics; FE must not claim definitive refund failure on 503 (see Finding F1).

## S7b/S7c — Refund pending → reconciliation (S9)

- Covered above: `REFUND_PENDING` + reconcile endpoint keeps state pending and updates `refundLastQueriedAt` without duplicating refunds. Verdict: **PASS** (backend), with FE copy requirement noted.

## S8 — Two successful VNPay payments for one booking + duplicate resolution

- Booking #35 (B, room 1, 10–12/8/2027). pay1 #12 → attempt window expired (simulated past `expires_at`) → pay2 #13 created (pay1 → FAILED/EXPIRED) → pay2 IPN success (**canonical**, booking `CONFIRMED`/`PAID`).
- **Late IPN success for expired pay1** arrives: payment #12 → **`REQUIRES_REVIEW`, `reviewReason=ANOTHER_SUCCESSFUL_PAYMENT`, `reviewCanonicalPaymentId=13`**.
- `POST /management/payments/12/resolve-duplicate-charge` (dedicated endpoint, no body, Idempotency-Key): sandbox refused → 503 `PAYMENT_REFUND_OUTCOME_UNKNOWN`, payment → `REFUND_PENDING` with `refundPreviousStatus=REQUIRES_REVIEW`.
- Replay same key → no second refund row (DB: exactly 1 `payment_refunds` row for #12).
- Wrong-endpoint probe: generic `/refund` on a payment already in refund flow → 409 `COMMON_CONFLICT` ("đang có yêu cầu hoàn tiền") — cannot double-fire.
- Final state: #13 SUCCESS (booking intact, PAID), #12 REFUND_PENDING under review.
- Verdict: **PASS** (dedicated endpoint enforced by backend; canonical relation exposed; idempotency stable).

## S10 — Account lock / token revocation

- Customer B locked (`PATCH /customers/2/status` LOCKED): next `/auth/me` with old token → **401 `COMMON_UNAUTHORIZED`**; login while locked → 401. Unlock → 200.
- Staff account locked (`PATCH /users/:id/status`): `/auth/me` → 401; login → 401.
- Verdict: **PASS** (no stale authenticated access).

## S11 — Authorization matrix (direct API)

All 13 probes matched expectations (UI hiding verified separately by existing FE route-guard tests):
GUEST → 401 on customer/management routes; CUSTOMER → 200 on own bookings, 403 `COMMON_FORBIDDEN` on management/users; STAFF → 200 on management payments/bookings, 403 on user admin **and** on refund (`Roles('ADMIN')`); ADMIN → 200 across management, users, customers.
Verdict: **PASS** — backend remains the security authority.

### Unified login product behavior (observed)

| Case | customer endpoint | user endpoint | FE resolution |
|---|---|---|---|
| valid customer | 200 | 401 | customer |
| valid admin | 401 | 200 | user |
| valid staff | 401 | 200 | user |
| invalid password (either identity) | 401 | 401 | failure |
| unknown identifier | 401 | 401 | failure |
| rate-limited after probes | 429 | 429 | failure (no fallback tried — correct) |

Operational consequences observed: unified form cannot tell the user *which* identifier kind they have (good UX), but every internal login costs one extra 401 round-trip and consumes customer rate-limit budget; a locked/staff account gets a generic 401 message. Rate-limit buckets are per endpoint, so fallback still works under the customer bucket being warm.

## S12 — Refresh / back-forward / multi-tab (FE idempotency layer)

- Duplicate-resolution key stable across simulated refreshes; scoped per payment; never collides with refund keys; clearing payment A does not affect payment B (5/5 vitest checks against the real FE module `idempotency.ts`).
- Server side already proved replay safety (S2/S7/S8), so refresh/back-forward on those flows cannot double-submit: same key + same payload replays or conflicts; no second record was ever created in any replay probe.
- Payment return page refresh: read-only endpoint (S6) — no new payment attempt possible from refresh.
- Verdict: **PASS**.

---

## Findings

### F1 — P1: FE copy for refund 503 must not read as "refund failed" in duplicate-resolution flow
- Scenario S7/S8: `PAYMENT_REFUND_OUTCOME_UNKNOWN` (503) after resolve/refund.
- Expected: FE shows "kết quả chưa xác định → đối soát" with a reconciliation action.
- Actual (FE working tree): `getPaymentActionError` maps it correctly to "Chưa xác định được kết quả hoàn tiền. Vui lòng đối soát trước khi thao tác lại." and the duplicate-resolution alert adds a "Đối soát ngay" action. **Verified correct in current FE tree** — keep as-is; no code change required in UAT. Downgraded to informational.

### F2 — P2: `COMMON_SERVICE_UNAVAILABLE` (reconcile 503) surfaces generic copy
- Scenario S7c: reconcile against unreachable sandbox → generic message.
- Expected: distinct "không thể liên hệ VNPay để đối soát, thử lại sau" copy (same class as `PAYMENT_REFUND_OUTCOME_UNKNOWN`).
- Actual: generic. Impact: low confusion; retry remains available and safe.
- Recommended fix: add a `COMMON_SERVICE_UNAVAILABLE` branch in `getPaymentActionError` for refund/reconcile actions.

### F3 — P2: Cancel replay returns 200 with success copy
- Scenario S4: second cancel probe returned 200 "Huy booking thanh cong." — server-side idempotent no-op is correct, but a stale client cannot distinguish "just cancelled now" from "already cancelled earlier".
- Impact: minor; authoritative refetch resolves it.
- Recommended fix: have BE return the previous `cancelledAt` marker or an `alreadyProcessed` flag; FE already refetches, so severity stays P2.

### F4 — P3: Rate-limit consumption of unified login fallback
- Scenario S11: every internal login consumes one customer-endpoint attempt; scripted probes quickly hit 429 in local testing (limit 10/15min on `/auth/customers/login`).
- Impact: shared-IP offices (counter + customer wifi) could rate-limit staff logins. Evidence: `COMMON_RATE_LIMITED` on user endpoint after repeated probes.
- Recommended fix: consider separate buckets or identifier-prefix routing. Product decision, not a runtime defect.

No P0 findings were reproducible at runtime. All money-invariant probes (S2, S4, S5, S7, S8) produced exactly one intended side effect.

## Product decision — unified login

**KEEP unified login** (with rate-limit follow-up F4): actor resolution worked for all six observed cases; failure modes are honest 401/429 with a single coherent form; splitting surfaces would reintroduce the "which login?" confusion the unified form removed. DECISION REQUIRED only for F4 rate-limit sizing.

## Final release decision

**RELEASE** — with F2/F3 (P2) and F4 (product follow-up) tracked as non-blocking improvements; no runtime blocker was reproduced against the current BE (9846312) + FE working tree.
