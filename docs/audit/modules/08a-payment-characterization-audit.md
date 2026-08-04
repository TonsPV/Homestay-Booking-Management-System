# Lượt 8A - Payment characterization

Ngày thực hiện: 2026-07-29  
Trạng thái gate: `PASS`

## 1. Phạm vi

Chỉ characterization `PaymentService` 1.716 dòng. Không tách service, không đổi
money/state rule, controller, route, response, entity hoặc migration trong 8A.

## 2. Test được bổ sung

Thêm `payment.service.spec.ts` với 11 case trực tiếp:

- manual CASH thành công và cập nhật Booking atomically;
- BANK_TRANSFER idempotent replay;
- idempotency key reuse sai request bị từ chối;
- tạo VNPay PENDING với gateway reference/deadline;
- IPN sai signature không mở transaction;
- IPN đúng signature nhưng sai amount không mở transaction;
- IPN success cập nhật đồng thời Payment và Booking;
- late success sau booking cancel chuyển `REQUIRES_REVIEW`;
- manual refund cập nhật Booking/Payment và xóa RoomCalendar cùng transaction;
- provider timeout giữ refund ở `REFUND_PENDING`, không tự retry;
- expiration chỉ cập nhật batch PENDING VNPay đã lock.

## 3. Đối chiếu use-case

| Use case/rule | Direct unit | MySQL E2E | Kết quả |
|---|---|---|---|
| Manual CASH/BANK_TRANSFER | Success + replay + key conflict | Payment/refund flow | PASS |
| VNPay create | URL/reference/deadline snapshot | Online flow | PASS |
| IPN signature/amount/status | Invalid signature, amount, success | IPN primary flow | PASS |
| Return trước/sau IPN | Controller/gateway unit | Return redirect + IPN-before-Return | PASS |
| Late callback | `REQUIRES_REVIEW` direct | Expired booking callback | PASS |
| Manual refund | Atomic Booking/Payment/Calendar | Full flow | PASS |
| VNPay refund timeout | Giữ `REFUND_PENDING` | Timeout + reconcile | PASS |
| Ambiguous/accepted/rejected refund | Gateway normalization unit | Ba refund E2E flow | PASS |
| Callback/refund lặp | Replay direct một phần | E2E idempotency/reconcile | PASS |
| Expiration | Locked batch direct | Booking/payment expiry | PASS |

## 4. Money và security invariant

- Amount callback được so với payment snapshot bằng integer/`BigInt`, không dùng
  floating point.
- Callback sai signature hoặc sai amount không thay đổi DB.
- Manual mutation, callback mutation và refund completion giữ Booking/Payment/
  RoomCalendar trong transaction tương ứng.
- Refund timeout không tự động gửi lại mutation; trạng thái chờ phải reconcile.
- `VnPayGatewayService` cấu hình `enableLog: false`.
- Log của `PaymentService` chỉ chứa nguồn callback/payment ID và stack lỗi; không
  log raw callback query, hash secret hoặc signed payload.

## 5. Coverage

Targeted Payment:

| Thành phần | Statement | Branch | Function | Line |
|---|---:|---:|---:|---:|
| `PaymentService` | 55,25% | 40,83% | 63,93% | 55,06% |
| `VnPayGatewayService` | 86,79% | 72,00% | 95,65% | 86,53% |
| Tổng targeted | 60,99% | 46,20% | 72,61% | 60,72% |

Coverage thấp của facade lớn là thêm bằng chứng cho structural debt 8B; không
dùng con số tổng để thay thế matrix direct unit + MySQL E2E.

## 6. Regression gate

- Build: PASS.
- Lint: PASS.
- Payment targeted: 3 suite, 22/22 PASS.
- Full unit: 29 suite, 218/218 PASS.
- MySQL E2E: 34/34 PASS khi rerun.

Lần chạy E2E đầu có một failure ở Room cover concurrency (hai mutation đều 200
nhưng immediate read thấy 0 cover). Không có code Room/Payment runtime đổi; chạy
lại ngay cùng suite PASS 34/34. Không sửa test không liên quan để che flaky timing.

Log `Simulated VNPay timeout` là fixture có chủ đích.

## 7. Architecture gate

`PaymentService` vẫn 1.716 dòng và trộn Query, Manual, VNPay Collection, Refund,
Expiration. Theo đúng mục tiêu 8A, chưa tách trong lượt này.

Characterization đủ để bắt đầu 8B theo thứ tự bắt buộc:

1. Query;
2. Manual;
3. VNPay Collection;
4. Refund;
5. facade/controller/route/response giữ ổn định;
6. full unit/E2E sau từng extraction.
