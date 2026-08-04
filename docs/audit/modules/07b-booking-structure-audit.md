# Lượt 7B - Booking structure and fixes

Ngày cập nhật: 2026-07-29  
Trạng thái: `PASS`

## Mục tiêu

Tách tuần tự Query → Creation → Lifecycle sau characterization 7A, giữ
`BookingService` làm facade và không đổi controller, route, response hoặc DB.

## Bước 1 - Query capability

Trạng thái: `PASS`.

Đã thực hiện:

- tạo `BookingQueryService`;
- chuyển customer/management list, detail, pagination, filter, ownership scope
  và response mapping sang Query service;
- `BookingService` giữ nguyên bốn public query method và delegate;
- thêm 5 test query trực tiếp;
- chạy full unit/E2E trước khi sang Creation.

Gate:

- Booking targeted: 16/16 test PASS tại checkpoint;
- full unit: 197/197 PASS;
- MySQL E2E: 34/34 PASS;
- build và lint: PASS.

## Bước 2 - Creation capability

Trạng thái: `PASS`.

Đã chuyển nguyên transaction boundary sang `BookingCreationService`:

- online/counter booking;
- customer resolution và contact/phone normalization;
- room pessimistic lock và guest-capacity rule;
- price snapshot bằng integer cents/`BigInt`;
- một `RESERVED` calendar row cho mỗi đêm;
- payment deadline;
- duplicate customer/calendar key mapping sang 409.

Facade chỉ lấy booking ID từ capability rồi đọc response qua Query service. Không
đổi public method hoặc response envelope.

Gate sau riêng bước Creation:

- Booking targeted: 16/16 PASS;
- full unit: 197/197 PASS;
- MySQL E2E: 34/34 PASS;
- build và lint: PASS.

## Bước 3 - Lifecycle capability

Trạng thái: `PASS`.

Đã chuyển nguyên transaction boundary sang `BookingLifecycleService`:

- customer cancellation và ownership hiding;
- management state transition;
- refund-pending guard;
- check-in/check-out và Room operational transition;
- payment expiration batch;
- VNPay pending failure và RoomCalendar cleanup.

Sau extraction, bổ sung thêm 10 characterization case cho counter creation,
capacity, valid/invalid transition, refund pending, check-out, room maintenance,
paid cancellation, ownership và empty expiration batch.

Gate sau riêng bước Lifecycle:

- Booking targeted: 26/26 PASS;
- full unit: 207/207 PASS;
- MySQL E2E: 34/34 PASS;
- OpenAPI contract: 2/2 PASS;
- build và lint: PASS.

Log `Simulated VNPay timeout` trong E2E là failure fixture có chủ đích; suite vẫn
PASS.

## Kết quả cấu trúc

| Thành phần | Trước 7B | Sau 7B | Trách nhiệm |
|---|---:|---:|---|
| `BookingService` | 1.083 | 101 | Facade ổn định cho controller |
| `BookingQueryService` | 0 | 262 | Query, scope, pagination, response mapping |
| `BookingCreationService` | 0 | 497 | Create transaction và validation |
| `BookingLifecycleService` | 0 | 404 | State machine và cleanup transaction |
| `booking.types.ts` | 0 | 42 | Response type dùng chung, không tạo type cycle |

`BookingExpirationService` vẫn là scheduler adapter 17 dòng và gọi public facade,
không chứa business rule trùng lặp.

## Gate 7B

7B được đóng `PASS`:

- thứ tự Query → Creation → Lifecycle được giữ;
- full unit/E2E được chạy giữa từng capability;
- facade/public methods và controller behavior ổn định;
- không đổi entity, migration, route, DTO hoặc OpenAPI response shape;
- không phát hiện runtime defect mới; structural debt của Booking đã được xử lý.
