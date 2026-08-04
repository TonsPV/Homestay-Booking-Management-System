# Lượt 8C - Payment verification

Ngày thực hiện: 2026-07-29  
Trạng thái gate: `PASS`

## 1. State-machine coverage

Sau 8B, bổ sung thêm bốn direct case:

- verified VNPay refund hoàn tất và release calendar;
- explicit rejection khôi phục `SUCCESS`;
- unverified/ambiguous result giữ `REFUND_PENDING`;
- reconciliation hoàn tất mà không gửi lại refund mutation.

Targeted coverage cuối:

| Thành phần | Statement | Branch | Function | Line |
|---|---:|---:|---:|---:|
| Payment tổng | 78,53% | 60,92% | 89,28% | 78,15% |
| Shared booking policy | 75,00% | 56,25% | 100% | 75,00% |
| Manual | 83,09% | 70,58% | 100% | 82,60% |
| Collection | 74,01% | 52,05% | 78,94% | 73,71% |
| Refund | 74,68% | 56,47% | 93,54% | 74,47% |
| Query | 87,71% | 73,80% | 93,33% | 87,27% |
| Facade | 81,81% | 76,47% | 63,63% | 80,00% |
| VNPay Gateway | 86,79% | 72,00% | 95,65% | 86,53% |

Refund branch tăng từ 31,76% lên 56,47% nhờ direct success/reject/ambiguous/
reconcile cases. Các provider/callback variants còn lại có gateway unit và MySQL
E2E.

## 2. Booking/Payment status invariant

Đã đối chiếu code, unit, E2E và data audit:

| Flow | Payment | Booking payment | Booking lifecycle |
|---|---|---|---|
| Manual success | `SUCCESS` | `PAID` | Pending → Confirmed |
| VNPay verified success | `SUCCESS` | `PAID` | Pending → Confirmed |
| Failed/expired VNPay | `FAILED` | Không tự chuyển `PAID` | Không xác nhận |
| Late success sau cancel | `REQUIRES_REVIEW` | Không update từ callback muộn | Giữ Cancelled |
| Refund pending/ambiguous | `REFUND_PENDING` | Giữ `PAID` | Giữ trạng thái |
| Refund rejected | Khôi phục previous status | Giữ `PAID` | Giữ trạng thái |
| Refund completed | `REFUNDED` | `REFUNDED` | Cancelled + calendar release |

Callback chưa verify hoặc sai amount không mở mutation transaction.

## 3. Transaction và dependency boundary

- Facade 139 dòng chỉ inject Query, Manual, Collection và Refund.
- Manual transaction sở hữu Payment + Booking mutation.
- Collection callback transaction lock Booking rồi Payment.
- Refund completion transaction cập nhật Payment + Booking + RoomCalendar.
- Query read-only, không mở transaction.
- Scheduler adapter 17 dòng chỉ gọi public expiration method.
- Shared booking policy loại bỏ rule trùng giữa Manual và Collection.

## 4. Data audit

`npm run data:audit` PASS 10/10, mỗi check có 0 violation:

- active/cancelled booking calendar;
- single success payment;
- Booking/Payment status agreement;
- room occupancy;
- room image cover;
- amenity join orphan;
- expired booking/payment;
- stale refund.

## 5. OpenAPI và log security

- `docs/openapi.json` đã regenerate.
- `npm run openapi:validate`: 2/2 PASS.
- Không đổi route, DTO hoặc success/error envelope.
- Gateway dùng `enableLog: false`.
- Collection/Refund log chỉ source, payment ID, booking ID và error stack.
- Không log raw callback query, signed payload, secure hash hoặc
  `VNPAY_HASH_SECRET`.

## 6. Regression gate

- Build: PASS.
- Lint: PASS.
- Payment targeted: 4 suite, 31/31 PASS.
- Full unit: 30 suite, 227/227 PASS.
- MySQL E2E: 1 suite, 34/34 PASS.
- Data audit: 10/10 PASS, 0 violation.
- OpenAPI contract: 2/2 PASS.
- `git diff --check` cho Payment/audit/OpenAPI: PASS.

Log `Simulated VNPay timeout` là failure fixture có chủ đích và suite E2E vẫn
PASS.

## 7. Kết luận

Payment được đóng `PASS`. Structural debt 1.716 dòng đã được thay bằng facade và
bốn capability rõ ràng, money/state invariants giữ nguyên, không có regression
runtime hoặc contract.

Lượt tiếp theo theo kế hoạch: `Lượt 9 - Dashboard`.
