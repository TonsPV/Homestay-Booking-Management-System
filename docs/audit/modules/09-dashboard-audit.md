# Lượt 9 - Dashboard

Ngày thực hiện: 2026-07-29  
Trạng thái backend gate: `PASS`  
Trạng thái Phase Dashboard liên repository: `PARTIAL`

## 1. Phạm vi

Audit `DashboardQueryService` read-only, controller authorization, metric SQL,
date boundary, empty system, index/query plan và OpenAPI.

Không tách service vì 315 dòng chỉ sở hữu một read capability và không có
mutation/state machine.

## 2. Metric matrix

| Metric/rule | Công thức đã kiểm tra | Kết quả |
|---|---|---|
| Date range | Việt Nam `+07:00`, inclusive end bằng `< to + 1 day` | PASS |
| Max range | Chính xác 366 ngày được phép, 367 bị từ chối | PASS |
| Booking status | Aggregate theo `bookings.created_at` trong range | PASS |
| Collected | Chỉ `Payment.SUCCESS`, lọc theo `paid_at` | PASS |
| Refunded | Chỉ `Payment.REFUNDED`, lọc theo `refunded_at` | PASS |
| Review/pending | Count `REQUIRES_REVIEW` và `REFUND_PENDING` | PASS |
| Room status | READY/OCCUPIED/CLEANING/MAINTENANCE, bỏ soft-deleted | PASS |
| Reserved nights | RESERVED, bỏ Booking CANCELLED | PASS |
| Blocked nights | BLOCKED, bỏ Room deleted/HIDDEN | PASS |
| Capacity | Room operational × inclusive days − blocked nights | PASS |
| Occupancy | Reserved / available, clamp 0-100 | PASS |
| Empty/zero-room | Mọi count/amount/rate trả 0, không NaN | PASS |

## 3. Unit/E2E

`dashboard-query.service.spec.ts` hiện có 6 test:

- aggregate mapping và SQL predicate;
- timezone/inclusive formula;
- empty/zero-room;
- invalid date, reverse range, >366 days;
- migration index up/down.

Coverage:

| Statement | Branch | Function | Line |
|---:|---:|---:|---:|
| 98,00% | 86,36% | 100% | 97,91% |

Authorization E2E:

- anonymous: 401;
- Customer: 403;
- Staff: 200 với aggregate thật;
- ADMIN dùng cùng `@Roles('ADMIN', 'STAFF')` policy đã được RolesGuard matrix bảo
  vệ.

## 4. Query index fix

Phát hiện các range predicate Dashboard chưa có composite index phù hợp. Đã thêm
migration `1784782000000-AddDashboardQueryIndexes.ts` và entity metadata:

- `bookings(created_at, status)`;
- `payments(status, paid_at)`;
- `payments(status, refunded_at)`;
- `payments(created_at, status)`;
- `room_calendar(status, stay_date)`.

Test DB sau migration xác nhận đủ năm index và đúng column order. `EXPLAIN` revenue
query liệt kê `idx_payments_status_paid_at` trong `possible_keys`; optimizer chọn
single status index do test dataset chỉ 1 estimated row. Vì dữ liệu hiện tại nhỏ,
không suy diễn performance production từ cost này; migration bảo vệ predicate
shape và cần theo dõi slow query khi có production volume.

`npm run migration:show` trên DB hiện tại hiển thị migration mới ở trạng thái
pending `[ ]`; không tự chạy migration lên DB phát triển trong lượt audit.

## 5. Regression gate

- Build: PASS.
- Lint: PASS.
- Dashboard targeted: 6/6 PASS.
- Full unit: 30 suite, 229/229 PASS.
- MySQL E2E: 34/34 PASS, migration mới áp dụng thành công trên test DB.
- Dashboard coverage: 98,00% statement, 86,36% branch.
- OpenAPI route/response: không đổi.

## 6. Architecture và phase gate

Backend Dashboard đi đúng hướng:

- controller chỉ map HTTP/envelope;
- query service read-only;
- không transaction/service split thừa;
- SQL metric có direct test và E2E authorization.

Tuy nhiên plan yêu cầu FE loading/error/empty/success và browser E2E trước khi
đóng toàn Phase Dashboard. Repository hiện tại chỉ là backend; không có frontend
artifact để xác minh. Vì vậy backend module được đóng `PASS`, còn phase liên
repository giữ `PARTIAL` và tiếp tục theo DQ-001.

Lượt backend tiếp theo: `Lượt 10 - Health/runtime`.
