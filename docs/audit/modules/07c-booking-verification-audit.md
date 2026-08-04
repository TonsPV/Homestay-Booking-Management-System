# Lượt 7C - Booking verification

Ngày thực hiện: 2026-07-29  
Trạng thái gate: `PASS`

## 1. Response và OpenAPI

Đã đối chiếu tám route Booking hiện có:

- customer: create, list, detail, cancel;
- management: create, list, detail, update status.

Controller vẫn dùng `BookingDto` trong success envelope; hai list route vẫn khai
báo array + pagination metadata. `BookingResponse` được chuyển sang
`booking.types.ts` và re-export từ facade nên controller contract không đổi.

Không có route hoặc DTO change trong 7B/7C, vì vậy không phát sinh yêu cầu
regenerate `docs/openapi.json`. `npm run openapi:validate` PASS 2/2.

## 2. State-machine coverage

Targeted coverage sau khi bổ sung nhánh trực tiếp:

| Thành phần | Statement | Branch | Function | Line |
|---|---:|---:|---:|---:|
| Booking tổng | 85,11% | 68,61% | 96,96% | 84,72% |
| Creation | 79,05% | 58,51% | 100% | 78,76% |
| Lifecycle/state machine | 86,66% | 76,08% | 100% | 86,32% |
| Query | 93,84% | 72,50% | 100% | 93,65% |
| Facade | 91,30% | 76,92% | 80% | 90,47% |

Lifecycle branch tăng từ 63,04% lên 76,08% sau khi thêm case valid/invalid
transition, refund pending, check-out, room maintenance, paid cancel, ownership
và empty expiration.

Các nhánh còn lại chủ yếu là validation/error mapping phụ; main business state
transitions đều có direct unit hoặc MySQL E2E.

## 3. Dependency và transaction boundary

| Service | Dependency inject | Transaction boundary |
|---|---:|---|
| `BookingService` | 3 capability | Không mở transaction; chỉ điều phối |
| `BookingQueryService` | 1 repository | Read-only, không transaction |
| `BookingCreationService` | `DataSource`, `ConfigService` | Một transaction cho Customer/Room/Booking/Calendar |
| `BookingLifecycleService` | `DataSource`, `ConfigService` | Một transaction cho Booking/Payment/Room/Calendar mutation |

Không có transaction bị chia cắt bởi facade. Room vẫn được pessimistic-lock khi
create/check-in/check-out; calendar và payment cleanup vẫn nằm cùng lifecycle
transaction.

## 4. Service size và design

- Facade giảm từ 1.083 xuống 101 dòng.
- Không capability service nào vượt 500 dòng.
- Controller chỉ map HTTP sang facade.
- Business rule nằm trong Creation/Lifecycle, query mapping nằm trong Query.
- Shared response type tách riêng, loại bỏ type-only dependency từ Query quay về
  facade.
- Không tạo helper/service trùng lặp, file tạm hoặc migration rác.

Kết luận: hướng capability facade phù hợp design hiện tại và không làm hệ thống
phồng thêm theo trách nhiệm trùng lặp.

## 5. Regression gate

- Build: PASS.
- Lint: PASS.
- Booking targeted: 2 suite, 26/26 PASS.
- Full unit: 28 suite, 207/207 PASS.
- MySQL E2E: 1 suite, 34/34 PASS.
- OpenAPI contract: 2/2 PASS.
- Entity/migration/route/response: không đổi.

Log `Simulated VNPay timeout` là E2E fixture xác minh provider failure, không phải
test failure.

## 6. Capability matrix cuối

| Capability | Trạng thái | Evidence |
|---|---|---|
| Online/counter create | PASS | Unit + MySQL E2E |
| Price/calendar atomicity | PASS | Unit + unique-key concurrent E2E |
| Cancel/release/payment cleanup | PASS | Unit + E2E |
| State/check-in/check-out | PASS | Lifecycle 76,08% branch + E2E |
| Expiration | PASS | Unit batch/empty + E2E |
| Public/management scope | PASS | Query unit + authorization E2E |
| Response/OpenAPI | PASS | DTO audit + contract test |
| Service structure | PASS | 101/262/497/404 dòng theo capability |

Lượt Booking được đóng. Lượt tiếp theo theo kế hoạch là `8A - Payment
characterization`.
