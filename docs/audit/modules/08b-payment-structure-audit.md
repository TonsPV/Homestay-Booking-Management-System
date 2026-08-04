# Lượt 8B - Payment structure and fixes

Ngày cập nhật: 2026-07-29  
Trạng thái: `PASS`

## Mục tiêu

Tách tuần tự Query → Manual → VNPay Collection → Refund sau 8A, giữ facade,
controller, route, response và DB contract ổn định. Mỗi capability phải qua full
unit/E2E trước bước tiếp theo.

## Bước 1 - Query capability

Trạng thái: `PASS`.

- Tạo `PaymentQueryService`.
- Chuyển customer/management list, ownership scope, filter, pagination, detail
  và response mapping.
- Tạo `payment.types.ts` cho response type dùng chung.
- Thêm 5 test query trực tiếp.

Gate: Payment targeted 27/27, full unit 223/223, MySQL E2E 34/34, build/lint
PASS.

## Bước 2 - Manual capability

Trạng thái: `PASS`.

Chuyển nguyên khối sang `PaymentManualService`:

- CASH/BANK_TRANSFER transaction;
- Booking pessimistic lock;
- manual idempotency và duplicate-key reconciliation;
- pending VNPay conflict/expiry cleanup;
- Booking payment/status transition.

Gate sau riêng bước Manual: Payment targeted 27/27, full unit 223/223, MySQL
E2E 34/34, build/lint PASS.

## Bước 3 - VNPay Collection capability

Trạng thái: `PASS`.

Chuyển nguyên khối sang `PaymentCollectionService`:

- create payment URL/reference/deadline;
- online idempotency;
- IPN/Return signature, amount, reference và status processing;
- late callback và `REQUIRES_REVIEW`;
- online payment expiration batch.

Gate sau riêng bước Collection: Payment targeted 27/27, full unit 223/223,
MySQL E2E 34/34, build/lint PASS.

## Bước 4 - Refund capability

Trạng thái: `PASS`.

Chuyển nguyên khối sang `PaymentRefundService`:

- manual refund;
- VNPay refund preparation/idempotency;
- provider timeout và ambiguous result;
- explicit rejection restore;
- reconciliation;
- verified completion và Booking/Calendar cleanup.

Không thêm automatic retry cho refund mutation. Provider timeout vẫn để
`REFUND_PENDING` và yêu cầu reconciliation.

Gate sau riêng bước Refund:

- Payment targeted 27/27 trước verification cases;
- full unit 223/223;
- MySQL E2E 34/34;
- OpenAPI contract 2/2;
- build/lint PASS.

## Shared policy

Manual và Collection ban đầu cùng cần booking lock, payable-state rule và expired
VNPay cleanup. Ba rule này được đặt trong `payment-booking-policy.ts` để tránh
nhân đôi business rule giữa hai capability.

## Kết quả cấu trúc

| Thành phần | Trước 8B | Sau 8B | Trách nhiệm |
|---|---:|---:|---|
| `PaymentService` | 1.716 | 139 | Facade ổn định cho controller/scheduler; thêm stale-refund visibility ở Lượt 10 |
| `PaymentQueryService` | 0 | 232 | Scope, query, pagination, response mapping |
| `PaymentManualService` | 0 | 244 | CASH/BANK_TRANSFER và idempotency |
| `PaymentCollectionService` | 0 | 587 | VNPay create/IPN/Return/expiration |
| `PaymentRefundService` | 0 | 751 | Manual/VNPay refund và reconciliation |
| `payment-booking-policy.ts` | 0 | 81 | Shared booking lock/payment policy |
| `payment.types.ts` | 0 | 60 | Shared public response types |

`PaymentRefundService` nằm trong ngưỡng 500-800 nhưng chỉ sở hữu một capability
state machine có characterization và E2E mạnh; không tách nhỏ thêm khi chưa có
bằng chứng về responsibility boundary ổn định hơn.

## Gate 8B

8B được đóng `PASS`:

- giữ đúng thứ tự Query → Manual → Collection → Refund;
- full unit/E2E chạy giữa từng extraction;
- facade/public methods, scheduler và controller behavior ổn định;
- không đổi entity, migration, route, DTO hoặc response shape;
- không tự retry refund;
- không còn service nào vượt 800 dòng.
