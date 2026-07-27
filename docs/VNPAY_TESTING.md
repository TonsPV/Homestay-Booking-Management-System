# VNPay Sandbox And IPN Testing

## Callback Roles

- `GET /api/v1/payments/vnpay/ipn` is the primary server-to-server callback.
- `GET /api/v1/payments/vnpay/return` receives the customer browser redirect.
- Both callbacks verify the VNPay checksum, terminal code, gateway reference,
  amount, and transaction result before changing data.
- Both callbacks use the same database transaction and row locks. The first
  valid callback applies the result; the second is treated as already processed.
- The frontend never changes a Payment or Booking status.

The signed Return fallback is useful during local Sandbox testing, where VNPay
cannot reach `localhost`. A public IPN remains required for deployment because
the customer may close the browser before Return is loaded.

## Sandbox Card Flow

Create a fresh payment attempt with a fresh `Idempotency-Key`:

```http
POST /api/v1/bookings/:bookingId/payments
Authorization: Bearer <customer-token>
Idempotency-Key: booking-21-vnpay-attempt-002
Content-Type: application/json
```

```json
{
  "bankCode": "VNBANK",
  "locale": "vn"
}
```

Open the returned `paymentUrl`, choose the NCB Sandbox bank, and use the test
card details from the official VNPay Sandbox documentation:

https://sandbox.vnpayment.vn/apis/docs/gioi-thieu/

Do not use a real banking application to scan a Sandbox QR code. Omit
`bankCode` to choose a method at VNPay, or use `VNBANK` for the test card flow.

## Public IPN With A Local API

Start the API on port 3000, then expose it temporarily with one tunnel:

```bash
ngrok http 3000
```

or:

```bash
cloudflared tunnel --url http://localhost:3000
```

Register this exact URL in VNPay Merchant/SIT for the terminal:

```text
https://<temporary-public-host>/api/v1/payments/vnpay/ipn
```

VNPay stores the IPN URL for the merchant terminal; it is not a parameter in
the payment URL. If the browser also needs a public Return endpoint, set:

```env
VNPAY_RETURN_URL=https://<temporary-public-host>/api/v1/payments/vnpay/return
```

Restart the API after changing environment variables. Tunnel hosts are
temporary, so update the registered IPN URL whenever the host changes.

## Frontend Return

Leave this empty while no frontend exists:

```env
VNPAY_FRONTEND_RETURN_URL=
```

When the frontend result page is available:

```env
VNPAY_FRONTEND_RETURN_URL=http://localhost:5173/payment-result
```

The backend Return endpoint then responds with HTTP 302 to that page and adds:

- `validSignature`
- `paymentId`
- `bookingId`
- `paymentStatus`
- `responseCode`
- `transactionStatus`

These values are display hints. The result page must fetch the booking/payment
API again and render the database state.

## Expected Results

IPN arrives first:

1. IPN returns `RspCode=00`.
2. Payment becomes `SUCCESS`.
3. Booking becomes `PAID` and normally `CONFIRMED`.
4. Return reads the completed state without applying it again.

Return arrives first:

1. The signed Return fallback applies the same successful transaction.
2. Payment and Booking become paid.
3. A later IPN returns `RspCode=02` (`Order already confirmed`).

Invalid checksum or amount:

1. No Payment or Booking state changes.
2. IPN returns the VNPay-compatible error code.

Use the VNPay SIT portal to exercise registered public IPN test cases:

https://sandbox.vnpayment.vn/vnpaygw-sit-testing/user/login

## Full Refund And Reconciliation

Only `ADMIN` can refund a payment. A VNPay refund requires a fresh
`Idempotency-Key`:

```http
POST /api/v1/management/payments/:paymentId/refund
Authorization: Bearer <admin-token>
Idempotency-Key: refund-payment-13-001
Content-Type: application/json
```

```json
{
  "reason": "Customer requested a refund"
}
```

The service marks the Payment `REFUND_PENDING` and commits before calling
VNPay. A verified full-refund response changes Payment and Booking to
`REFUNDED`, cancels the Booking, and releases its room calendar. A verified
rejection restores the previous Payment status. A timeout, invalid response
signature, or ambiguous provider code keeps `REFUND_PENDING`.

Repeating the same refund key performs reconciliation instead of sending
another refund. Admin can also trigger it explicitly:

```http
POST /api/v1/management/payments/:paymentId/reconcile-refund
Authorization: Bearer <admin-token>
```

Reconciliation uses VNPay `queryDr` and only finalizes transaction type `02`
with status `00` and the expected amount. Booking transitions are blocked
while the Payment is `REFUND_PENDING`.

For old VNPay payments, the original `vnp_CreateDate` is read from the stored
payment URL. New payments also store it in `gateway_transaction_date`.
