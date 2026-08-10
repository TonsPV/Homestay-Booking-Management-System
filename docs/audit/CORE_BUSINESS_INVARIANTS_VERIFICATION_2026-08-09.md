# Core Business Invariants Verification

Ngày kiểm định: 2026-08-09  
Repository: `TonsPV/Homestay-Booking-Management-System`  
Phạm vi: Booking, Room, RoomType, Amenity, Customer, Payment/VNPay, Audit, Health, database migration, OpenAPI và regression tests.

## Trạng thái cuối

`NOT READY — CRITICAL BUSINESS RISK REMAINS`

Các kiểm thử kỹ thuật hiện đều đạt, nhưng hệ thống chưa có luồng hợp lệ để xử lý một giao dịch VNPay thành công đến muộn khi booking hợp lệ đã có một payment `SUCCESS`. Payment bị đưa vào `REQUIRES_REVIEW`, trong khi refund policy chỉ cho refund payment `REQUIRES_REVIEW` nếu booking đã `CANCELLED`. Ngoài ra, data audit trên DB local phát hiện ba refund VNPay đã ở `REFUND_PENDING` quá bảy ngày và cần đối soát thực tế. Không được tự hủy booking, tự hoàn tiền hoặc tự đổi trạng thái các giao dịch tài chính này, nên trạng thái cuối được giữ ở mức chưa sẵn sàng.

## 1. Executive summary

### Confirmed bugs

- Room có thể bị ADMIN chuyển khỏi `OCCUPIED` trong khi vẫn có Booking `CHECKED_IN`, hoặc được đặt `OCCUPIED` khi không có Booking `CHECKED_IN`. Lỗi được tái hiện trong E2E cũ và đã sửa bằng policy + transaction lock.
- Management Booking query dùng inner join theo mặc định của TypeORM nên Booking lịch sử biến mất khi Customer, Room hoặc RoomType liên quan bị soft-delete. Đã sửa bằng cách gọi `withDeleted()` trước khi đăng ký các join lịch sử.
- Kết quả refund/reconcile VNPay chưa xác minh có thể ghi đè transaction ID và response code đang dùng cho lần đối soát sau. Đã sửa: dữ liệu định danh/kết quả gateway chỉ được lưu sau khi xác minh.
- Callback thanh toán VNPay thành công thiếu/sai `vnp_PayDate` từng có thể lấy thời gian máy chủ làm `paidAt`. Đã sửa: callback thành công bắt buộc có ngày VNPay hợp lệ.
- Runtime của thư viện `vnpay` có thể trả `isVerified=true` cho QueryDr không chứa `vnp_SecureHash`. Đã sửa: response đối soát bắt buộc có chữ ký, đúng reference/merchant và được thư viện xác minh trước khi hoàn tất refund.
- Refund/QueryDr outbound call không có deadline hữu hạn nên gateway treo có thể giữ request vô hạn. Đã thêm `VNPAY_REQUEST_TIMEOUT_MS`; raw refund dùng cả abort signal và application deadline, QueryDr dùng application deadline rồi đi vào nhánh pending/503 hiện có.
- Hai thao tác set-cover đồng thời có thể để Room còn `0` cover do MySQL `REPEATABLE READ` + TypeORM dirty-check trên snapshot cũ. Full E2E đã tái hiện; đã đổi sang explicit `UPDATE is_cover=true` trong transaction và stress E2E 8 lượt.
- Chưa có business audit log bền vững cho các mutation quan trọng. Đã bổ sung bảng, service và audit trong cùng transaction.
- Health readiness trước đây che nguyên nhân probe DB mà không có log điều tra. Đã bổ sung log có `operation`, `errorCode`, `requestId`, loại lỗi; không log connection string/credential.
- Logic kiểm tra khoảng lưu trú/search từng nằm ở nhiều đường code. Đã gom quy tắc ngày, số đêm và nửa khoảng `[checkIn, checkOut)` vào `BookingStayPolicy`, đồng thời dùng chung predicate lịch phòng cho public/management.
- `schema:check` phát hiện metadata của thay đổi cấu hình giường có sẵn trong worktree lệch giữa DB đã migrate và entity hiện tại (index thừa, `ON UPDATE CASCADE`). Đã thêm migration tương thích tiến tới, không sửa migration đã chạy.

### Confirmed risks

- **Critical — NEEDS_DECISION:** giao dịch thu tiền VNPay trùng trên một Booking vẫn hợp lệ không có endpoint/quy trình resolution hoặc refund hợp lệ. Chi tiết ở Phase 7.
- **Critical operational data:** DB local có Payment `15`, `16`, `17` ở `REFUND_PENDING` từ 2026-07-26/27; cả ba đã quá bảy ngày tại thời điểm audit. Cần gọi luồng reconcile với cấu hình VNPay hợp lệ và người có thẩm quyền; audit không tự đổi trạng thái.
- Static review cho thấy kiểm tra soft-delete RoomType trước khi tạo Room và kiểm tra Amenity trước khi gán chưa nằm trong một transaction/lock chung. Chưa có reproduction runtime; đây là race risk, không được báo cáo là bug đã tái hiện.
- Check-out sớm hiện chuyển Room sang `CLEANING` nhưng không giải phóng các ngày tương lai trong `room_calendar`. Không tự đổi vì repo chưa có policy về đêm không sử dụng sau early checkout.
- Health readiness chỉ probe process/DB; chưa probe image storage. Việc storage là local bắt buộc hay external tùy môi trường chưa được quy định.
- Các capability service Payment đã tách theo query/manual/collection/refund, nhưng `PaymentRefundService` và một số service Booking vẫn lớn; đây là rủi ro bảo trì, không phải bằng chứng lỗi nghiệp vụ.

### Already correct — no change

- Chống double-booking đã có lớp bảo vệ cuối ở DB: unique `(room_id, stay_date)` trên `room_calendar`, cộng transaction, lock Room và re-check trong write path.
- Booking state graph đã được tập trung trong `BookingTransitionPolicy`, có same-state rõ ràng và các điều kiện payment/date/Room.
- Booking đã lưu `total_amount` tại lúc tạo; read path không tính lại từ `RoomType.basePrice`.
- Payment đã có unique gateway transaction/reference và idempotency key; callback đã verify signature, merchant, amount và reference từ dữ liệu server.
- Refund model đã lưu payment/booking, full amount, request/reference, trạng thái, thời gian, actor và reason; project không hỗ trợ partial refund.
- Public và management route vẫn tách quyền theo guards/decorators hiện có; không thêm authorization pattern mới.
- `synchronize` vẫn là `false`; mọi thay đổi persistence có migration.

### Implemented

- Shared stay/availability policy và consistency tests.
- Runtime MySQL concurrency tests cho cùng phòng, khác phòng, khoảng liền kề và release khi cancel.
- Room operational invariant với lock order Booking → Room.
- Historical Booking read qua soft-deleted relations.
- VNPay callback/refund verification hardening và structured operational logs.
- QueryDr bắt buộc signed response; outbound VNPay có deadline cấu hình 1–120 giây (mặc định 10 giây).
- Room Image giữ đúng một cover dưới concurrent set-cover.
- Transactional audit log cho Booking, Room, Payment/Refund, Customer, User.
- Request ID propagation, readiness logging và OpenAPI header/query/response documentation.
- Environment validator từ chối JWT placeholder cố định đang có trong `.env.example`; file mẫu không thể được dùng nguyên làm secret runtime.
- Audit/schema migrations và migration compatibility cho metadata giường.

### Not implemented

- Resolution workflow/endpoint cho payment `REQUIRES_REVIEW` do một Booking hợp lệ bị thu thêm tiền.
- Advanced audit timeline/read API.
- Image storage readiness probe.
- Housekeeping scheduling, seasonal pricing, promotion, notification, Room-Amenity override hoặc các feature ngoài core invariant.

### Blocked

- Không còn environment blocker: MySQL local/test DB hoạt động, migration/schema/E2E đã chạy.
- Product blocker: cần người có thẩm quyền xác nhận cách xử lý duplicate charge mà vẫn giữ Booking `CONFIRMED`/`PAID` và calendar của giao dịch hợp lệ.
- Operational blocker: ba refund pending lâu ngày cần VNPay reconciliation; không thể kết luận thành công/thất bại chỉ từ repository hoặc DB local.

## 2. Phase results

### Phase 0 — Baseline audit

**Status:** `COMPLETED`

**Evidence:**

| Hạng mục | Baseline thực tế |
| --- | --- |
| Booking states | `PENDING_PAYMENT`, `CONFIRMED`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED` |
| Booking payment states | `UNPAID`, `PAID`, `REFUNDED` |
| Room states | `READY`, `OCCUPIED`, `CLEANING`, `MAINTENANCE`, `HIDDEN` |
| Payment states | `PENDING`, `SUCCESS`, `FAILED`, `REQUIRES_REVIEW`, `REFUND_PENDING`, `REFUNDED` |
| Refund model | Full refund trên Payment; có idempotency key/request ID, gateway transaction/result, reason, requester, requested/reconciled/refunded timestamps |
| Availability | `room_calendar`; mỗi đêm là `[checkIn, checkOut)`, `RESERVED` hoặc `BLOCKED` |
| Pricing | `Booking.totalAmount = RoomType.basePrice × nights` tại thời điểm tạo |
| Transaction boundaries | Booking create/cancel/status/expiry; Payment create/callback/refund/reconcile; Room status/image/calendar mutations |
| DB protection | Calendar unique room/date, booking date/check/amount constraints, payment gateway/idempotency unique indexes, relevant query indexes |

**Files changed:** không sửa code trong Phase 0.  
**Tests:** baseline được đối chiếu tiếp bằng unit/E2E/schema ở các phase sau.  
**Remaining risk:** tài liệu audit cũ chỉ dùng tham khảo; source/migration/test hiện tại là source of truth.

### Phase 1 — Booking concurrency / double booking

**Status:** `NO CHANGE REQUIRED` cho cơ chế bảo vệ; `COMPLETED` cho runtime verification.

**Evidence:**

- Booking creation chạy trong transaction, lock Room bằng `pessimistic_write` rồi insert calendar cho từng đêm.
- `uq_room_calendar_room_date (room_id, stay_date)` là lớp bảo vệ cuối; duplicate key được map sang `409 BOOKING_ROOM_UNAVAILABLE`.
- MySQL E2E khởi tạo hai Customer mới để quota không thể che lấp race: hai request cùng room/range trả đúng một `201` và một `409`.
- Hai room khác nhau trả `201/201`; cùng room với `[10,12)` và `[12,14)` trả `201/201`; cancel xóa calendar và cho phép booking thay thế.

**Files changed:** `test/booking-create-query-workflow.e2e-spec.ts`; phần dùng shared stay policy trong `booking-creation.service.ts`.  
**Tests:** full E2E pass; test chính tại `allows only one overlapping online booking under concurrency`.  
**Remaining risk:** không dùng in-memory mutex; độ an toàn phụ thuộc InnoDB, migration unique còn nguyên và write path không bị bypass bởi một writer ngoài hệ thống.

### Phase 2 — Single source of truth cho availability

**Status:** `COMPLETED`

**Evidence:**

- `BookingStayPolicy` dùng chung parse ISO date, ngày Việt Nam, max advance, tối đa 90 đêm, count và enumerate nửa khoảng.
- Public search và management availability gọi cùng `applyAvailabilityWindow`: không có row `room_calendar` với `stay_date >= checkIn AND stay_date < checkOut`.
- Create Booking vẫn là authoritative write path; search chỉ là advisory read path.
- `HIDDEN` và `MAINTENANCE` bị loại khỏi public/management bookable result và create path.

**Files changed:** `booking-stay.policy.ts`, `booking-stay.policy.spec.ts`, `booking-creation.service.ts`, `room-query.service.ts`, module wiring và E2E liên quan.  
**Tests:** unit stay policy; public/management/create consistency E2E; date/capacity/quota E2E.  
**Remaining risk:** early checkout release policy chưa được định nghĩa.

### Phase 3 — Booking state machine

**Status:** `NO CHANGE REQUIRED`

**Evidence:** `BookingTransitionPolicy` đã là evaluator trung tâm; graph và điều kiện động được test. Controller không tự đặt graph riêng. Mutation invalid bị chặn trước side effects; same-state là idempotent.  
**Files changed:** không đổi graph; chỉ nối actor/requestId/audit ở lifecycle/controller và mở rộng tests.  
**Tests:** transition policy matrix, Booking service lifecycle, full E2E.  
**Remaining risk:** policy giờ theo ngày Việt Nam, không có rule phút check-in sớm vì repo không định nghĩa.

### Phase 4 — Room operational state machine

**Status:** `COMPLETED`

**Evidence:**

- `RoomStatusTransitionPolicy` buộc Room là `OCCUPIED` khi có Booking `CHECKED_IN`, và cấm `OCCUPIED` khi không có Booking `CHECKED_IN`.
- Transaction `READ COMMITTED` lock các Booking candidate `CONFIRMED/CHECKED_IN` theo ID trước, sau đó lock Room; cùng lock order với Booking lifecycle để tránh stale overwrite/deadlock ngược thứ tự.
- ADMIN có thể quản lý `HIDDEN`; STAFF không được chuyển từ/đến `HIDDEN`.
- Check-in yêu cầu Room `READY` rồi chuyển sang `OCCUPIED`; check-out chuyển sang `CLEANING` trừ khi Room đã `HIDDEN`/`MAINTENANCE`.

**Files changed:** `room-status-transition.policy.ts`, spec, `room-mutation.service.ts`, module wiring, Room unit/E2E.  
**Tests:** 25 policy cases; Room policy/facade 43 tests ở targeted run; full E2E pass.  
**Remaining risk:** trạng thái dọn phòng không có SLA/scheduling; không tự thêm.

### Phase 5 — Price snapshot

**Status:** `NO CHANGE REQUIRED`

**Evidence:** `Booking.totalAmount` được tính bằng decimal-safe integer cents từ `RoomType.basePrice × nights` và được lưu. Booking response đọc field này, không tính lại từ RoomType.  
**Files changed:** chỉ tăng cường E2E snapshot.  
**Tests:** booking 2 đêm giữ `250.00` sau khi base price đổi; booking mới 2 đêm dùng giá mới thành `400.00`.  
**Remaining risk:** chỉ snapshot tổng tiền; chưa lưu nightly rate/currency/discount breakdown vì model hiện tại chưa có pricing engine/discount.

### Phase 6 — Payment idempotency

**Status:** `COMPLETED`

**Evidence:**

- Verify SecureHash, `vnp_TmnCode`, `vnp_TxnRef`, amount và transaction status/date trước mutation.
- Callback lock Payment/Booking; replay payment đã xử lý không tạo Payment, không confirm Booking hoặc ghi audit lần hai.
- DB unique cho gateway transaction ID, gateway reference và request idempotency key.
- Success đến sau cancellation hoặc khi đã có payment success khác chuyển thành `REQUIRES_REVIEW`, không ghi đè Booking hợp lệ.
- MySQL E2E dùng cùng gateway transaction ID cho payment của Booking khác: unique constraint chặn, callback không acknowledge success và transaction thứ hai giữ `PENDING`/`UNPAID`.

**Files changed:** `payment-collection.service.ts`, `vnpay-gateway.service.ts`, controllers, OpenAPI và tests.  
**Tests:** invalid signature, amount mismatch, invalid pay date, success/replay, failure-after-success không downgrade, transaction ID trùng Booking khác, another successful payment và Return/IPN ordering.  
**Remaining risk:** cần quyết định chính thức Return có được mutation như fallback hay chỉ IPN là authority; behavior hiện tại giữ tương thích với code/test đang có.

### Phase 7 — Refund correctness

**Status:** `PARTIAL`

**Evidence hoàn tất:**

- Model lưu trace full refund: payment/booking/amount, gateway reference/request/result, previous status, reason, actor và timestamps.
- VNPay refund dùng unique idempotency key/request ID; replay pending chuyển sang reconcile, không gửi refund mutation thứ hai.
- Response refund/reconcile chưa verify không còn được phép ghi transaction ID/code; success bắt buộc signature/correlation, full amount, transaction type `02`, status `00` và non-empty transaction ID.
- QueryDr thiếu SecureHash bị coi là unverified dù client library trả `isVerified=true`.
- Refund và reconcile có deadline cấu hình; hung gateway không giữ request vô hạn.
- Manual/VNPay refund hoàn tất cập nhật Payment, Booking, calendar và audit trong cùng transaction.

**Critical gap — NEEDS_DECISION:**

1. Booking hợp lệ đã có Payment A `SUCCESS`.
2. VNPay báo Payment B cũng thành công.
3. Payment B trở thành `REQUIRES_REVIEW` với reason `ANOTHER_SUCCESSFUL_PAYMENT`.
4. Refund policy hiện chỉ nhận `REQUIRES_REVIEW` nếu Booking là `CANCELLED`.
5. Booking vẫn hợp lệ nên không được tự hủy; repo không có review-resolution endpoint.

**Stale refund data trên DB local:**

| Payment | Booking | Requested at (UTC) | Last queried at (UTC) |
| --- | --- | --- | --- |
| `15` | `25` | `2026-07-26T13:44:49.005Z` | Chưa đối soát |
| `16` | `27` | `2026-07-26T13:55:49.770Z` | `2026-07-27T04:03:22.930Z` |
| `17` | `28` | `2026-07-27T03:53:43.061Z` | `2026-07-30T14:34:57.902Z` |

**Files changed:** `payment-refund.service.ts`, `vnpay-gateway.service.ts`, Payment tests/audit/OpenAPI.  
**Tests:** manual refund/replay; VNPay timeout/pending/replay/reconcile/reject/unsigned/unverified/missing transaction ID; refund Payment chưa `SUCCESS` và Booking `CHECKED_IN` đều bị chặn trước gateway/mutation/audit.  
**Remaining risk:** duplicate charge chưa có đường hoàn tiền giữ nguyên Booking; manual refund hiện idempotent theo trạng thái nhưng chưa có chính sách bắt buộc `Idempotency-Key` như VNPay. DB local còn Payment `15`, `16`, `17` cần đối soát.

### Phase 8 — Soft delete / historical integrity

**Status:** `COMPLETED`

**Evidence:** `BookingQueryService.createBookingQuery()` gọi `withDeleted()` trước join Customer → Room → RoomType. E2E soft-delete trực tiếp cả ba entity rồi management detail vẫn trả đúng principal/room/type. Booking và Payment không bị cascade-delete.  
**Files changed:** `booking-query.service.ts`, unit spec, booking E2E.  
**Tests:** management historical read after related soft deletes.  
**Remaining risk:** Amenity không được snapshot vào Booking — đúng scope hiện tại; lịch sử tiện nghi tại thời điểm đặt vì thế không được bảo toàn.

Behavior cụ thể:

| Entity soft-delete | Behavior đã xác minh |
| --- | --- |
| Room | Management Booking history vẫn đọc Room; API Room từ chối xóa Room có lịch sử và hướng dẫn dùng `HIDDEN`; public active catalog không hiển thị soft-deleted Room. |
| RoomType | Management Booking history vẫn đọc RoomType qua Room; active Room/public query vẫn lọc soft-deleted RoomType. |
| Customer | Management Booking history vẫn đọc Customer; Booking còn snapshot contact name/phone/email. Auth/active Customer query không dùng tài khoản soft-deleted. |
| Amenity | Soft-delete không xóa Booking/Payment; active RoomType response chỉ dùng Amenity còn active. Không có historical amenity snapshot theo model hiện tại. |

### Phase 9 — Business audit log

**Status:** `COMPLETED`

**Evidence:**

- `audit_logs` có actor type/id, action, entity type/id, request ID, JSON metadata và timestamp; không có polymorphic FK để lịch sử không bị mất khi parent bị xóa.
- Actions: Booking create/status/cancel; Room status; Payment confirm; refund request/complete; Customer/User lock/unlock.
- `AuditLogService.record()` nhận cùng `EntityManager`; audit fail làm fail business transaction. Đây là consistency semantics được triển khai, không phải best effort.
- Không lưu password, JWT, authorization header, VNPay secret hoặc toàn request body.
- Same-state/replay không ghi audit trùng.

**Files changed:** `src/module/audit/**`, migrations `1784787000000`, `1784788000000`, module/controller/service integrations, `test/audit-log-workflow.e2e-spec.ts`.  
**Tests:** E2E xác minh 7 record cùng request ID (Booking ×3, Room ×1, Customer ×1, User ×2) và same-state suppression.  
**Remaining risk:** chưa có read API/retention/export policy.

### Phase 10 — Observability

**Status:** `PARTIAL`

**Evidence hoàn tất:** request context có `requestId`; booking conflict, callback verification/processing, refund request/reconcile và readiness failure dùng structured key-value log chứa `operation`, entity ID khi có, `errorCode`, `requestId`; health live/ready và DB probe có E2E. VNPay refund/QueryDr có deadline cấu hình; API create/refund/reconcile khai báo 503.  
**Files changed:** request context, health controller, environment config, Booking/Payment services/controllers, OpenAPI.  
**Tests:** Health unit/E2E, Payment log/deadline tests, response envelope/OpenAPI tests.  
**Remaining risk:** image storage chưa được readiness probe; một số service log cũ ngoài core scope chưa được chuẩn hóa toàn bộ.

### Phase 11 — Index / database constraint review

**Status:** `COMPLETED`

**Evidence:**

- Booking: indexes customer, creator, `(room_id, check_in_date, check_out_date)`, status, payment status/expiry và dashboard aggregate.
- Authoritative availability: unique `(room_id, stay_date)` và status/date indexes.
- Payment: booking/status; unique gateway transaction/reference, create/refund idempotency; paid/refunded/created aggregate indexes.
- Room: room type/status; RoomType-Amenity join có composite ownership key và amenity lookup index.
- Audit: action/time, entity/time, actor/time và request ID indexes.
- `synchronize: false`; schema changes đi qua forward migrations.

**Files changed:** audit migrations/data source/migration contract; compatibility migration `1784789000000`.  
**Tests:** migration contract 23 tests, `migration:show`, `migration:run`, `schema:check`; rollback enum `USER` fail-safe nếu còn User audit history.  
**Remaining risk:** RoomType/Amenity mutation race nêu ở Executive summary chưa được runtime verify.

### Phase 12 — Regression test

**Status:** `COMPLETED`

**Evidence:** bảng command ở mục 9. Full unit 53 suites/443 tests; full E2E 23 suites/109 tests. Full E2E đã phát hiện Room Image có thể còn 0 cover; lỗi được sửa và suite cuối pass.  
**Files changed:** unit/E2E/OpenAPI contract fixtures theo đúng business behavior đã sửa; `room-image.service.ts` dùng explicit update sau bulk reset.  
**Remaining risk:** fixture VNPay không thay thế chứng nhận sandbox/production từ gateway thật.

### Phase 13 — Review diff

**Status:** `COMPLETED`

**Evidence:** `git status --short`, `git diff --stat`, diff theo module, secret/debug scan và `git diff --check` đã chạy. Không có `.env` thật, debug dump hoặc agent-skill lọt vào diff/commit; `docs/openapi.json` được regenerate bằng script.  
**Worktree boundary:** dòng JWT trong `.env.example` đang staged và toàn bộ bed-configuration files/migration `1784786000000` đã tồn tại trước lượt core-invariant audit; nội dung người dùng đó được bảo toàn. Audit chỉ thêm timeout VNPay vào file mẫu và làm environment validator từ chối giá trị JWT mẫu cố định để không thể dùng nguyên. Migration `1784789000000` sửa schema drift do `schema:check` phát hiện, không rollback thiết kế `beds[]`.  
**Remaining risk:** worktree chứa nhiều thay đổi từ task trước; nên tách commit theo scope khi người dùng yêu cầu commit.

### Phase 14 — Final report

**Status:** `COMPLETED`

**Evidence:** tài liệu này ghi kết quả Phase 0–14, state matrices, command thực chạy và risk chưa xử lý.  
**Remaining risk:** final status không được nâng lên cho tới khi duplicate-charge resolution được quyết định, triển khai và test.

## 3. Booking concurrency

**Can two concurrent requests double-book the same room?**

`NO — verified by MySQL E2E: two near-concurrent requests for the same Room and overlapping range produced exactly one HTTP 201 and one HTTP 409 with BOOKING_ROOM_UNAVAILABLE; the database retained one calendar owner for each booked night.`

Lớp bảo vệ:

1. Application admission lock Customer khi áp quota và lock Room khi tạo Booking.
2. Write transaction tạo Booking + toàn bộ calendar rows.
3. Database unique `uq_room_calendar_room_date` quyết định cuối cùng nếu hai writer vẫn cạnh tranh.
4. Duplicate key được chuyển thành domain conflict, không trả lỗi DB thô.

## 4. State machines

### Booking

Điều kiện chung: same-state luôn allowed/idempotent. `REFUND_PENDING` chặn mọi transition khác trạng thái. Bảng dưới đây thể hiện graph và điều kiện động thực tế.

| From | To | Allowed |
| --- | --- | --- |
| `PENDING_PAYMENT` | `PENDING_PAYMENT` | Có — same-state |
| `PENDING_PAYMENT` | `CONFIRMED` | Có nếu đã thanh toán; counter booking (`createdByUserId != null`) được confirm khi chưa thanh toán theo policy hiện tại |
| `PENDING_PAYMENT` | `CHECKED_IN` | Không |
| `PENDING_PAYMENT` | `CHECKED_OUT` | Không |
| `PENDING_PAYMENT` | `CANCELLED` | Có |
| `CONFIRMED` | `PENDING_PAYMENT` | Không |
| `CONFIRMED` | `CONFIRMED` | Có — same-state |
| `CONFIRMED` | `CHECKED_IN` | Có nếu `PAID`, ngày hiện tại `>= checkIn` và `< checkOut`, Room còn tồn tại và `READY` |
| `CONFIRMED` | `CHECKED_OUT` | Không |
| `CONFIRMED` | `CANCELLED` | Có nếu chưa `PAID`; nếu đã trả tiền phải refund trước |
| `CHECKED_IN` | `PENDING_PAYMENT` | Không |
| `CHECKED_IN` | `CONFIRMED` | Không |
| `CHECKED_IN` | `CHECKED_IN` | Có — same-state |
| `CHECKED_IN` | `CHECKED_OUT` | Có nếu Room còn tồn tại |
| `CHECKED_IN` | `CANCELLED` | Không |
| `CHECKED_OUT` | `PENDING_PAYMENT` | Không |
| `CHECKED_OUT` | `CONFIRMED` | Không |
| `CHECKED_OUT` | `CHECKED_IN` | Không |
| `CHECKED_OUT` | `CHECKED_OUT` | Có — same-state |
| `CHECKED_OUT` | `CANCELLED` | Không |
| `CANCELLED` | `PENDING_PAYMENT` | Không |
| `CANCELLED` | `CONFIRMED` | Không |
| `CANCELLED` | `CHECKED_IN` | Không |
| `CANCELLED` | `CHECKED_OUT` | Không |
| `CANCELLED` | `CANCELLED` | Có — same-state |

### Room

Quy tắc chung cho mọi cặp:

- Target `OCCUPIED` chỉ allowed khi có Booking `CHECKED_IN`.
- Target khác `OCCUPIED` chỉ allowed khi không có Booking `CHECKED_IN`.
- ADMIN áp quy tắc occupancy trên mọi state.
- STAFF áp cùng quy tắc nhưng không được chuyển từ hoặc đến `HIDDEN`.
- Same-state chỉ idempotent khi invariant occupancy vẫn đúng.

| From | To | Allowed |
| --- | --- | --- |
| `READY` | `READY` | ADMIN/STAFF: có nếu không có `CHECKED_IN` |
| `READY` | `OCCUPIED` | ADMIN/STAFF: có nếu có `CHECKED_IN` |
| `READY` | `CLEANING` | ADMIN/STAFF: có nếu không có `CHECKED_IN` |
| `READY` | `MAINTENANCE` | ADMIN/STAFF: có nếu không có `CHECKED_IN` |
| `READY` | `HIDDEN` | Chỉ ADMIN, nếu không có `CHECKED_IN` |
| `OCCUPIED` | `READY` | ADMIN/STAFF: có nếu không còn `CHECKED_IN` (repair) |
| `OCCUPIED` | `OCCUPIED` | ADMIN/STAFF: có nếu có `CHECKED_IN` |
| `OCCUPIED` | `CLEANING` | ADMIN/STAFF: có nếu không còn `CHECKED_IN` |
| `OCCUPIED` | `MAINTENANCE` | ADMIN/STAFF: có nếu không còn `CHECKED_IN` |
| `OCCUPIED` | `HIDDEN` | Chỉ ADMIN, nếu không còn `CHECKED_IN` |
| `CLEANING` | `READY` | ADMIN/STAFF: có nếu không có `CHECKED_IN` |
| `CLEANING` | `OCCUPIED` | ADMIN/STAFF: có nếu có `CHECKED_IN` (repair) |
| `CLEANING` | `CLEANING` | ADMIN/STAFF: có nếu không có `CHECKED_IN` |
| `CLEANING` | `MAINTENANCE` | ADMIN/STAFF: có nếu không có `CHECKED_IN` |
| `CLEANING` | `HIDDEN` | Chỉ ADMIN, nếu không có `CHECKED_IN` |
| `MAINTENANCE` | `READY` | ADMIN/STAFF: có nếu không có `CHECKED_IN` |
| `MAINTENANCE` | `OCCUPIED` | ADMIN/STAFF: có nếu có `CHECKED_IN` (repair) |
| `MAINTENANCE` | `CLEANING` | ADMIN/STAFF: có nếu không có `CHECKED_IN` |
| `MAINTENANCE` | `MAINTENANCE` | ADMIN/STAFF: có nếu không có `CHECKED_IN` |
| `MAINTENANCE` | `HIDDEN` | Chỉ ADMIN, nếu không có `CHECKED_IN` |
| `HIDDEN` | `READY` | Chỉ ADMIN, nếu không có `CHECKED_IN` |
| `HIDDEN` | `OCCUPIED` | Chỉ ADMIN, nếu có `CHECKED_IN` (repair) |
| `HIDDEN` | `CLEANING` | Chỉ ADMIN, nếu không có `CHECKED_IN` |
| `HIDDEN` | `MAINTENANCE` | Chỉ ADMIN, nếu không có `CHECKED_IN` |
| `HIDDEN` | `HIDDEN` | Chỉ ADMIN, nếu không có `CHECKED_IN` |

## 5. Payment / refund

| Tiêu chí | Kết quả |
| --- | --- |
| Gateway callback signature verification | Có. SecureHash được verify; merchant code phải khớp. Invalid signature không đụng DB. |
| Transaction reference verification | Có. Callback resolve Payment bằng server-generated `gatewayReference`; refund/reconcile correlate `TxnRef`, raw refund bắt buộc đúng `TmnCode`, QueryDr bắt buộc có SecureHash. |
| Amount verification | Có. Callback amount được so với `Payment.amount` snapshot trước và trong transaction; refund success phải khớp full amount. |
| Pay date verification | Có sau sửa. Callback success thiếu/sai `vnp_PayDate` bị từ chối. |
| Callback idempotency | Có. Payment/Booking lock + processed-state handling; replay không tạo side effect/audit lần hai. |
| Unique transaction protection | Có ở DB cho `gateway_transaction_id`, `gateway_reference`, create idempotency key và refund idempotency/request ID. |
| Refund idempotency | VNPay: có bằng unique key/request ID và reconcile-on-replay. Manual: repeated completed state không refund lần hai, nhưng chưa bắt buộc request key. |
| Unverified gateway result | Giữ `REFUND_PENDING`; không tin/lưu transaction identifier/result code chưa verify. |
| Gateway deadline | `VNPAY_REQUEST_TIMEOUT_MS`, mặc định 10.000 ms; validation cho phép 1.000–120.000 ms. Timeout đi vào pending/reconcile/503, không tự kết luận refund. |
| Refund type | Full refund. Không có partial refund nên không có tổng partial-refund cần cộng dồn. |
| Critical unresolved | Extra VNPay success trên Booking hợp lệ vào `REQUIRES_REVIEW` nhưng không có resolution/refund path giữ nguyên Booking. |

## 6. Pricing

```text
Booking price source: RoomType.basePrice tại transaction tạo Booking × số đêm
Snapshot field(s): Booking.totalAmount
Changing RoomType price affects old booking: NO
```

Giới hạn được xác minh: date range half-open; tối đa 90 đêm; decimal được tính bằng integer cents; DB check `total_amount >= 0`. Không tự thêm weekend/seasonal/discount/deposit rule.

## 7. Historical integrity

```text
Room: management Booking history vẫn đọc được; Room có history không bị hard-delete qua API
RoomType: management Booking history vẫn đọc được sau soft delete
Customer: management Booking history và contact snapshot vẫn còn sau soft delete
Amenity: không cascade Booking/Payment; active response lọc Amenity soft-deleted; không có booking-time amenity snapshot
```

Audit log không dùng FK đa hình tới domain entities, do đó actor/entity bị xóa không làm mất audit history.

## 8. Database changes

Migration mới của lượt core-invariant audit, lấy từ Git worktree:

1. `src/database/migrations/1784787000000-CreateAuditLogs.ts`
   - Tạo `audit_logs` và các index action/entity/actor/request ID.
2. `src/database/migrations/1784788000000-AddUserAuditEntityType.ts`
   - Thêm `USER` vào enum `audit_logs.entity_type` bằng forward migration; giữ riêng vì `1784787000000` đã được áp vào test DB trước khi User audit được nối. Down migration từ chối thu hẹp enum nếu còn User history thay vì xóa/corrupt audit.
3. `src/database/migrations/1784789000000-AlignRoomTypeBedMetadata.ts`
   - Migration tương thích có điều kiện, bỏ redundant legacy index và chuẩn hóa FK `ON UPDATE NO ACTION` theo entity hiện tại.

`1784786000000-CreateRoomTypeBeds.ts` và phần bed-configuration liên quan đã có trong worktree trước audit này; không được nhận là output mới của Phase 0–14. Audit chỉ giữ hướng `beds[]` và sửa metadata drift bằng migration mới, không chỉnh migration cũ đã chạy.

Kết quả DB cuối:

- `migration:show`: toàn bộ 20 migration được đăng ký đều `[X]`, gồm đến `1784789000000`.
- `schema:check`: PASS trên cả DB local và test sau khi chạy migration.
- `NODE_ENV=test npm run data:audit`: PASS 12/12 rule.
- `npm run data:audit` trên DB local: FAIL riêng rule `stale-refund` với 3 Payment (`15`, `16`, `17`); 11 rule còn lại PASS. Đây là operational data cần đối soát, không phải schema drift.

## 9. Test results

| Command | Result | Notes |
| --- | --- | --- |
| `npm ci` | PASS | Hoàn tất; chỉ có dependency deprecation warnings. |
| `npm run lint` | PASS | Full repository. |
| `npm run build` | PASS | Nest/TypeScript build. |
| `npm test -- --runInBand` | PASS | 53 suites, 443 tests. |
| `npm run test:e2e -- --runInBand` | PASS | 23 suites, 109 tests; dùng MySQL test DB và safety guard. Log timeout/duplicate-key là fixture dự kiến và assertions xác minh pending/rollback. |
| `npm run openapi:check` | PASS | Snapshot được regenerate bằng script trước khi check. |
| `npm run openapi:validate` | PASS | OpenAPI contract: 1 suite, 6 tests. |
| `npm run schema:check` | PASS | Metadata khớp DB sau migration `1784789000000`. |
| `git diff --check` | PASS | Không có whitespace error; Git chỉ cảnh báo quy đổi LF/CRLF của working copy. |

Các command bổ sung:

| Command | Result | Notes |
| --- | --- | --- |
| `npm run migration:run` | PASS | Áp 3 migration mới vào DB local; không sửa Booking/Payment business data. |
| `NODE_ENV=test npm run migration:show` | PASS | 20 migration `[X]`. |
| `NODE_ENV=test npm run data:audit` | PASS | 12/12 invariant rules, 0 violation. |
| `npm run data:audit` | FAIL | DB local có 3 refund `REFUND_PENDING` quá 7 ngày; cần reconciliation thực tế. |
| Booking/Room targeted E2E | PASS | 2 suites, 11 tests. |
| Payment/Audit targeted E2E | PASS | Bổ sung MySQL case duplicate gateway transaction ID khác Booking. |
| Payment/Audit targeted unit | PASS | 6 suites, 57 tests sau khi bổ sung 4 negative cases bắt buộc. |
| Room Image concurrency stress | PASS | 8 lượt liên tiếp, mỗi lượt 3/3 targeted E2E pass. |

Command history minh bạch:

- Lần full unit đầu báo OpenAPI snapshot stale; `docs/openapi.json` được regenerate bằng script rồi full unit pass.
- Lần full E2E đầu có hai test concurrency cũ monkeypatch sai private lock method; test được cập nhật theo lock order thực tế rồi full E2E pass.
- Lần schema check đầu phát hiện bed metadata drift; forward migration `1784789000000` được thêm/chạy rồi schema check pass.
- Sau khi thêm negative Payment tests, một full E2E run tái hiện Room Image còn 0 cover. Không rerun để bỏ qua: root cause REPEATABLE READ/dirty-check được sửa; stress 8 lượt và full E2E cuối đều pass.
- Lần kiểm tra DB local báo 3 migration pending; `migration:run` được chạy và `schema:check` sau đó pass. Data audit local vẫn cố ý FAIL vì không tự quyết định kết quả cho 3 refund stale.

## 10. Architecture and design-pattern assessment

**Tình trạng:** kiến trúc module hiện ổn định về compile/test và phù hợp quy mô monolith hiện tại, nhưng chưa thể gọi production-ready do product gap tài chính.

- Controller tiếp tục chỉ map HTTP/actor/request context; business rule nằm ở service/policy.
- `BookingTransitionPolicy`, `BookingStayPolicy` và `RoomStatusTransitionPolicy` là domain-policy/evaluator tập trung, giảm điều kiện rải rác.
- TypeORM `EntityManager` transaction đóng vai trò Unit of Work; pessimistic lock và DB constraint bảo vệ invariant quan trọng.
- Audit là module append-only dùng cùng transaction, không thay console log cho lịch sử nghiệp vụ.
- Public/management route separation và guard/decorator hiện hữu được giữ nguyên.
- Không thêm CQRS, event sourcing, Redis lock, broker hoặc microservice.
- Payment đã được tách thành query/manual/collection/refund capability services. Chưa tiếp tục refactor lớn vì public controller behavior cần ổn định và task ưu tiên invariant.

Hướng đi hiện tại là đúng ở tầng kỹ thuật: policy tập trung + transaction + MySQL constraint + E2E thật. Hướng đi chỉ được coi là hoàn tất sau khi chốt và triển khai policy resolution cho duplicate charge.

## 11. Remaining backlog

### Phải quyết định trước khi nâng trạng thái release

1. **Duplicate VNPay charge resolution:** có cho refund Payment thừa trong khi giữ Booking `CONFIRMED`/`PAID` và calendar không? Ai được thao tác? Audit action/reason nào? Resolution có cần maker-checker không?
2. **Đối soát dữ liệu local:** Payment `15`, `16`, `17` đang `REFUND_PENDING` quá 7 ngày; phải query VNPay bằng credential hợp lệ và ghi nhận kết quả qua reconcile flow.
3. Return mutation authority: tiếp tục cho browser Return làm fallback mutation hay bắt buộc IPN-only.
4. Manual refund idempotency contract: có bắt buộc `Idempotency-Key` giống VNPay không.
5. Early checkout: giữ toàn bộ future reserved nights hay release một phần; nếu release thì từ ngày nào.

### Kỹ thuật sau core

1. Runtime concurrency test/fix cho RoomType soft-delete ↔ Room create và Amenity soft-delete ↔ assignment.
2. Image storage readiness probe nếu deployment phụ thuộc storage external/shared.
3. Audit read timeline, retention và export policy.
4. Tách tiếp service lớn sau khi public methods đã có characterization tests ổn định.

### Feature không triển khai trong task này

- Housekeeping/cleaning workflow và maintenance scheduling.
- Seasonal pricing, promotion, discount/deposit engine.
- Booking notes/notifications nâng cao.
- Room amenity override.

## 12. Final status

`NOT READY — CRITICAL BUSINESS RISK REMAINS`

Hai lý do tài chính ngăn nâng trạng thái: Payment thừa `REQUIRES_REVIEW` trên Booking hợp lệ chưa có đường resolution/refund, và DB local còn ba refund pending quá bảy ngày chưa được VNPay reconciliation. Các invariant kỹ thuật khác trong scope đã được đối chiếu bằng source, migration và các command thực chạy nêu trên; trạng thái không được nâng chỉ vì test suite đang xanh.
