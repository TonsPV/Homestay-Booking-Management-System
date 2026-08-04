# Lượt 11 - Common HTTP, security và OpenAPI

Ngày thực hiện: 2026-07-29  
Trạng thái gate: `PASS`

## 1. Phạm vi

Các capability trực tiếp:

- app bootstrap/security: `configure-app.ts` (58 dòng);
- success envelope interceptor (52 dòng);
- error envelope/filter (105 dòng);
- Actors guard (39 dòng), Roles guard (64 dòng), rate-limit guard (87 dòng);
- response decorator (179 dòng), OpenAPI validator (112 dòng) và generator;
- common input normalization và DTO/schema dùng chung.

Đã đối chiếu 66 OpenAPI operation, 67 component schema và toàn bộ controller có
`@Actors`/`@Roles`. Không thay route, enum value, response runtime hay DB column.

## 2. Capability/flow matrix

| Capability | Happy path | Failure/edge path | Evidence |
|---|---|---|---|
| Success envelope | Plain result và `ApiResponse` payload được wrap một lần | `null`, custom message và pagination meta không bị mất | Interceptor/unit + E2E |
| Error envelope | `HttpException` giữ message/status phù hợp | Lỗi bất ngờ trả 500 sanitize | Filter unit |
| Request ID | ID hợp lệ đi vào header và body | ID có CR/LF/ký tự sai được thay bằng UUID | Configure unit + E2E |
| Unexpected error log | Log có request ID, method, path và stack nội bộ | Response không lộ lỗi nội bộ | Filter unit |
| Helmet/CORS | Helmet áp dụng toàn app; CORS dùng allowlist | Production thiếu `CORS_ORIGINS` bị từ chối khi validate environment | Unit + E2E security header |
| Validation boundary | DTO mô tả contract; service/common validator normalize và reject input | Empty, type, enum, length, date/number/phone boundary | 17 direct utility test + module unit/E2E |
| Rate limit | Bucket theo IP + method + controller + handler | Quá limit: 429 + `Retry-After`; hết window mở bucket mới | Guard + metadata unit |
| Actor/role | Metadata class/handler được Reflector đọc | Anonymous 401; sai actor/role 403; locked user 403 | Guard unit + module E2E |
| OpenAPI | Mọi documented response khác 204 có JSON schema | Snapshot cũ hoặc schema thiếu làm command fail | Generator check + 3 contract test |

Validation hiện đặt tại service/common validation boundary thay vì cài thêm
`class-validator` và Global `ValidationPipe`. Cách này giữ controller mỏng, DTO
không nhận type đã được tin cậy và không làm thay đổi hàng loạt contract hiện có.
Full unit coverage của `input-normalizer.ts`: 88,57% statement, 87,50% branch,
100% function.

## 3. Defect đã sửa

| ID | Severity | Phát hiện | Sửa và regression |
|---|---|---|---|
| HTTP-001 | P1 | OpenAPI validator chỉ kiểm tra 2xx và snapshot có thể cũ nhưng vẫn pass | Kiểm tra mọi response 1xx-5xx trừ 204; thêm `openapi:check` so sánh generated snapshot |
| HTTP-002 | P2 | Health readiness thiếu 503; auth rate-limit thiếu 429 trong OpenAPI | Thêm response decorator dùng `ErrorEnvelopeDto` |
| HTTP-003 | P2 | Một số manual 400/401/403/404/409 chỉ có description, không schema | Thay bằng common typed error decorators; validator xác nhận missing count = 0 |
| HTTP-004 | P2 | Ba DTO lặp lại toàn bộ success envelope | Giữ data DTO, bỏ `CustomerCredentialEnvelopeDto`, `RoomCalendarEntriesEnvelopeDto`, `UnblockRoomDatesEnvelopeDto`; dùng generic envelope decorator |
| HTTP-005 | P2 | Common interceptor/filter/guard/rate-limit thiếu direct unit | Bổ sung 18 direct test và metadata/security boundary |

Ba class DTO bị bỏ chỉ là schema trùng trong các file vẫn đang dùng; không xóa
file. `rg` xác nhận không còn reference. Compiler, OpenAPI generator, unit và E2E
đều PASS nên có thể khôi phục từ Git nếu cần.

## 4. Security và architecture

- `helmet()` chạy trước request-ID/static/controller pipeline.
- Production bắt buộc có CORS allowlist; development/test vẫn cho phép tool local.
- Request ID chỉ nhận `[A-Za-z0-9._:-]`, tối đa 200 ký tự.
- Guard luôn đọc metadata handler trước class; RolesGuard reload user hiện tại,
  không tin role cũ trong token.
- Static scan không thấy controller có `@Actors` thiếu `ActorsGuard` hoặc
  `@Roles` thiếu `RolesGuard`.
- Không có exported class name trùng; không có exported DTO/response/entity chỉ
  xuất hiện đúng một lần trong source scan.

Rate limiter hiện là bộ nhớ theo process. Behavior cho một instance đã PASS; khi
triển khai nhiều replica cần shared store/proxy topology rõ ràng, theo DQ-009.
Việc thống nhất các string-union actor/role/status sang enum là thay đổi chéo
Auth/User/Customer và được giữ cho Lượt 13 qua DQ-007.

## 5. Coverage và regression gate

Targeted:

- 10 suite, 42/42 test PASS;
- Common HTTP: 96,81% statement, 83,92% branch, 95,23% function, 96,59% line;
- OpenAPI contract: 93,33% statement, 83,33% branch, 100% function;
- common input normalization trong full suite: 88,57% statement, 87,50% branch,
  100% function.

Gate cuối:

- Build: PASS.
- Lint: PASS.
- Full unit: 39 suite, 257/257 PASS.
- MySQL E2E: 35/35 PASS.
- OpenAPI generate/check: PASS.
- OpenAPI contract: 3/3 PASS; 66 operation, missing response schema = 0.

## 6. Capability matrix

| Tiêu chí | Trạng thái |
|---|---|
| Success/error envelope | PASS |
| Request ID header/body/unexpected-error log | PASS |
| Helmet và production CORS allowlist | PASS |
| Validation boundary | PASS |
| Rate-limit behavior | PASS |
| Guard/decorator metadata | PASS |
| OpenAPI drift và response schema validator | PASS |
| Không có schema/entity/DTO trùng hoặc không dùng trong phạm vi | PASS |

Không còn P0/P1 trong phạm vi. Lượt tiếp theo:
`Lượt 12 - Database và maintenance`.
