# Lượt 10 - Health/runtime

## Security Round 5 addendum - 2026-07-30

The original Health audit below is retained as execution history. The current
readiness implementation supersedes the earlier `Promise.race` design:

- Readiness uses a dedicated one-connection mysql2 pool with queueing disabled.
- Connection acquisition and query execution share a validated 1000 ms default
  deadline.
- Timed-out, failed and late-acquired connections are destroyed; successful
  probes are released.
- One probe may run at a time and the public route is limited to 30 requests per
  minute per process/IP.
- A deterministic degraded-DB E2E and a real MySQL `SLEEP` integration test
  prove destruction and immediate one-slot pool reuse.
- Deployment must still restrict readiness to trusted infrastructure where
  possible.

Ngày thực hiện: 2026-07-29  
Trạng thái gate: `PASS`

## 1. Phạm vi và ownership

Phạm vi trực tiếp:

- `HealthController` (55 dòng, 2 public route, inject `DataSource`);
- `BookingExpirationService` (58 dòng, 1 cron capability, inject
  `BookingService` và `ConfigService`);
- `PaymentExpirationService` (62 dòng, 1 cron capability, inject
  `PaymentService` và `ConfigService`);
- environment validation, health/scheduler unit test và health E2E.

Dependency chỉ được dùng qua public facade: Booking, Payment, TypeORM và Nest
Scheduler. Worktree đã có nhiều thay đổi từ các lượt 0-9; lượt này không xóa,
reset hoặc ghi đè file ngoài phạm vi.

## 2. Route/runtime matrix

| Use case | Actor | Preconditions | Happy path | Failure/edge path | Invariant | Evidence |
|---|---|---|---|---|---|---|
| `GET /api/health/live` | Anonymous | App process đang chạy | 200, `status=ok` | Không phụ thuộc DB | Không gọi query | Unit + E2E |
| `GET /api/health/ready` | Anonymous | DB trả lời trong 1 giây | `SELECT 1`, 200 | DB reject hoặc timeout: 503 đã sanitize | Không trả hostname, credential, query hoặc stack | 3 unit + E2E DB thật |
| Booking expiration | Internal cron | Toggle bật | Expire pending booking và log count/duration | Toggle tắt: không mutation; lỗi: rethrow và log loại lỗi | Không log nội dung lỗi/stack | 3 unit |
| Payment expiration | Internal cron | Toggle bật | Expire pending online payment, đếm stale refund, log summary | Toggle tắt: không query/mutation; lỗi: rethrow và log loại lỗi | Không log nội dung lỗi/stack | 3 unit |

Health route không có actor/role restriction theo chủ đích để hạ tầng có thể
probe. Response vẫn đi qua success/error envelope và request-ID middleware dùng
chung.

## 3. Các cải thiện đã thực hiện

### Readiness timeout và response an toàn

- Giảm DB readiness timeout từ 5 giây xuống 1 giây.
- Giữ query tối thiểu `SELECT 1`.
- Mọi DB reject/timeout đều trả cùng
  `ServiceUnavailableException('Database is unavailable.')`.
- Unit test dùng timer kiểm tra đúng boundary 1 giây và kiểm tra lỗi nội bộ không
  xuất hiện trong response.

### Scheduler control và observability

- Thêm `EXPIRATION_SCHEDULERS_ENABLED`, mặc định `true`, validate boolean và mô
  tả trong `.env.example`.
- Khi tắt, cả hai scheduler thoát trước mọi query/mutation.
- Cron dùng `waitForCompletion: true`, tránh cùng một job chồng lần chạy.
- Completion/skip/failure dùng JSON structured log với event, count và duration.
- Failure log chỉ có `errorType`; không ghi error message, connection string,
  query hoặc stack trace.
- Shutdown hook đã tồn tại tại `configure-app.ts` qua
  `app.enableShutdownHooks()`.

### Stale refund visibility

- `PaymentQueryService.countStaleRefunds()` đếm
  `REFUND_PENDING` có `refundRequestedAt` quá 7 ngày.
- Payment scheduler đưa `staleRefundCount` vào summary mỗi phút.
- Data audit `stale-refund` vẫn là lớp kiểm tra độc lập khi vận hành thủ công/CI.

## 4. Coverage và regression gate

Targeted runtime suite:

- 5 suite, 25/25 test PASS;
- statement 96,73%, branch 85,18%, function 100%, line 96,59%;
- Health controller: 100% statement/line;
- Payment scheduler: 100% statement/line;
- Booking scheduler sau test failure path: 100% statement/line.

Regression gate cuối lượt:

- Build: PASS.
- Lint: PASS.
- Full unit: 32 suite, 238/238 PASS.
- MySQL E2E: 35/35 PASS, gồm readiness qua DB thật.
- Data audit: 10/10 invariant PASS, gồm `stale-refund`.
- OpenAPI generate: PASS.
- OpenAPI contract: 2/2 PASS.

## 5. Capability matrix

| Tiêu chí | Trạng thái | Bằng chứng |
|---|---|---|
| Liveness không phụ thuộc DB | PASS | Unit xác nhận query không được gọi |
| Readiness query/timeout/503 | PASS | `SELECT 1`, timeout 1 giây, unit + E2E |
| Không lộ chi tiết nội bộ | PASS | Sanitized exception và scheduler failure-log tests |
| Scheduler enable/disable | PASS | Environment validation + no-mutation tests |
| Structured summary log | PASS | Booking/payment summary tests |
| Stale refund visibility | PASS | Query unit + scheduler summary + data audit |
| Graceful shutdown hook | PASS | `configure-app.ts` và configure-app unit |

Không còn P0/P1 trong phạm vi Health/runtime. Hệ thống đi đúng hướng: health
probe nhỏ, scheduler chỉ điều phối qua facade, không tạo abstraction hoặc file
trùng không cần thiết.

Lượt tiếp theo: `Lượt 11 - Common HTTP, security và OpenAPI`.
