# HBMS Backend Workflow Test and Architecture Verification Plan

Ngày lập: 2026-08-01  
Phạm vi: Backend NestJS tại repository này và MySQL mà backend đang sử dụng.  
Loại tài liệu: kế hoạch kiểm chứng V2, thực hiện từng module hoặc capability; chưa
phải báo cáo rằng mọi workflow đã đúng.

## 1. Mục tiêu

Kế hoạch này trả lời bốn câu hỏi bằng bằng chứng có thể kiểm tra lại:

1. Mỗi module đang có những workflow nào, actor nào được dùng và state nào bị
   thay đổi?
2. Workflow nào đã có đủ unit, MySQL integration/E2E, contract và concurrency
   evidence; workflow nào mới chỉ có code hoặc test một phần?
3. Hành vi nào là defect đã tái hiện, hành vi nào chỉ là rủi ro từ code review,
   và hành vi nào chưa thể kết luận vì repository không có quyết định nghiệp vụ?
4. Kiến trúc, design pattern, module boundary, test architecture và release
   process có đủ ổn định để tiếp tục phát triển hay chưa?

Tài liệu
D:/HBMS/PROJECT_AUDIT_AND_IMPLEMENTATION_PLAN.md là kế hoạch chung được chính nó
xác định là nguồn ưu tiên khi roadmap khác nhau, tại dòng 12-14. Kế hoạch hiện
tại bổ sung lớp kiểm chứng workflow chi tiết; không tự thay đổi product rule,
route, response, enum hoặc database column.

## 2. Quy tắc chống kết luận không có bằng chứng

Mọi dòng trong báo cáo module phải dùng đúng một nhãn:

| Nhãn | Ý nghĩa |
|---|---|
| VERIFIED | Code hiện tại và test phù hợp đã chạy trên đúng snapshot; transaction/concurrency phải có MySQL evidence |
| CHARACTERIZED | Hành vi hiện tại đã được test nhưng chưa chứng minh đó là rule sản phẩm đã duyệt |
| GAP_EVIDENCE | Có implementation hoặc tài liệu nhưng thiếu test đủ mạnh |
| CANDIDATE_DEFECT | Có đường code hoặc xung đột invariant đáng ngờ nhưng chưa có test tái hiện |
| DEFECT | Đã tái hiện và trái một rule/contract có nguồn được duyệt |
| NEEDS_DECISION | Code, docs hoặc cách gọi metric mâu thuẫn; repository không đủ dữ liệu để tự chọn đúng/sai |
| BLOCKED_EXTERNAL | Cần FE, VNPay sandbox, email/SMS, proxy hoặc môi trường deploy thật |
| SUPERSEDED | Báo cáo lịch sử đã bị code, OpenAPI hoặc addendum mới thay thế |
| NOT_RUN | Chưa chạy command trên chính snapshot đang báo cáo |

Không được:

- dùng test xanh của ngày cũ làm bằng chứng cho worktree hiện tại;
- đổi GAP_EVIDENCE thành DEFECT;
- lấy coverage tổng làm bằng chứng một rule đã được bảo vệ;
- dùng TypeScript cast trong test để khẳng định runtime payload hợp lệ;
- coi file untracked là file rác;
- gọi một công thức Dashboard là sai khi chưa có định nghĩa sản phẩm;
- mock TypeORM repository để chứng minh transaction, lock hoặc MySQL constraint.

Một DEFECT bắt buộc phải có:

1. nguồn expected behavior;
2. test hoặc lệnh tái hiện;
3. actual behavior;
4. ảnh hưởng;
5. file và dòng code liên quan;
6. regression test đỏ trước và xanh sau khi sửa.

## 3. Snapshot hiện tại đã kiểm chứng

Thời điểm snapshot: 2026-08-01, múi giờ +07:00.  
Git HEAD: 489ecfbbcc77120fc0a5191a466ba0e37a76ede5, cộng với worktree chưa sạch.

| Hạng mục | Kết quả hiện tại | Kết luận đúng mức |
|---|---|---|
| Build | PASS | Nest compile được trên worktree hiện tại |
| Lint | PASS | Không có ESLint failure hiện tại |
| Unit | PASS, 42 suite / 302 test | Baseline test xanh; không đồng nghĩa đủ workflow |
| Unit coverage | 66,04% statement; 56,52% branch; 68,66% function; 66,20% line | Coverage tổng đã vượt 45%, critical branch vẫn cần xem riêng |
| MySQL E2E | PASS, 3 suite / 41 test | 39 test vẫn tập trung trong app.e2e-spec.ts |
| OpenAPI | 51 path / 67 operation / 71 schema; check PASS | 67/67 JSON 2xx có schema |
| Migration | 12 applied / 2 pending | Chưa đạt release gate |
| Schema check | FAIL, 13 pending schema operation | Development schema đang drift |
| Data audit | PASS, 10/10 invariant; 0 violation | Data hiện tại sạch theo 10 check đã viết |
| Production dependency audit | FAIL, 2 High record từ cùng js-yaml advisory qua Nest Swagger | Chưa chứng minh exploit; vẫn là release risk chưa đóng |
| Git status | 147 entry: 73 modified, 3 deleted, 71 untracked | Clean checkout chưa tái lập reviewed state |
| Static dependency scan | 176 production/script TS file; 483 runtime edge; 67 type-only edge; 0 runtime cycle; 0 unreachable | Không có bằng chứng source chết hoặc runtime import cycle hiện tại |
| CI | Không tìm thấy CI workflow; chỉ có compose.yaml cho MySQL | Gate hiện chưa được tự động thực thi |

Hai migration đang pending là:

- AddDashboardQueryIndexes1784782000000;
- AlignAmenityJoinMetadata1784783000000.

Vì vậy phải tách rõ ba kết luận:

- functional baseline hiện tại: xanh;
- audited data invariants hiện tại: xanh;
- schema/release readiness: chưa đạt.

Các số 66 OpenAPI operation, 36 E2E, service monolith và test count trong báo cáo
ngày 2026-07-29 là lịch sử. Chúng không được dùng làm current truth.

### 3.1. Inventory route và direct unit hiện tại

| Domain/capability | HTTP operation | Direct spec | Direct test block | E2E hiện tại |
|---|---:|---:|---:|---|
| Health | 2 | 2 | 10 | 2 dedicated E2E |
| Auth | 4 | 4 | 17 | Nằm trong app.e2e-spec.ts |
| User | 4 | 1 | 12 | Nằm trong app.e2e-spec.ts |
| Customer | 6 | 3 | 13 | Nằm trong app.e2e-spec.ts |
| Amenity | 8 | 1 | 10 | Nằm trong app.e2e-spec.ts |
| RoomType | 9 | 1 | 5 | Nằm trong app.e2e-spec.ts |
| Room/Image/Calendar | 16 | 4 | 23 | Nằm trong app.e2e-spec.ts |
| Booking | 8 | 3 | 28 | Nằm trong app.e2e-spec.ts |
| Payment/VNPay/Refund | 9 | 5 | 36 | Nằm trong app.e2e-spec.ts |
| Dashboard | 1 | 1 | 3 | Nằm trong app.e2e-spec.ts |

Direct test block chỉ là số khai báo test trong spec đặt cạnh domain. Nó không
phản ánh độ sâu assertion và không cộng các common/config/database/OpenAPI test.
Mỗi lượt vẫn phải trace rule → test cụ thể.

## 4. Đánh giá kiến trúc hiện tại

### 4.1. Kết luận ngắn

Kiến trúc đang đi đúng hướng cho một modular monolith chạy một instance. Chưa có
lý do dựa trên repo để chuyển sang microservice, event bus, CQRS hoặc Clean
Architecture toàn phần.

Tuy nhiên hệ thống chưa thể được gọi là ổn định để release. Các blocker và risk
chính là schema drift, reviewed code chưa nằm trong Git, dependency High chưa có
fix/risk acceptance, Auth ownership verification chưa hoàn chỉnh, test E2E tập
trung, và ownership của invariant Booking-Payment-RoomCalendar chưa đủ rõ.

### 4.2. Design pattern thực sự đang có

| Pattern/cấu trúc | Bằng chứng | Đánh giá |
|---|---|---|
| Modular monolith | src/app.module.ts:18-68 ghép chín domain module và Dashboard vào một app/MySQL | Phù hợp quy mô hiện tại |
| Layered Controller → Service → Repository | Controller không truy vấn Repository/DataSource trực tiếp | Giữ; controller đang mỏng |
| Facade | BookingService, PaymentService, RoomService ủy quyền capability service | Giữ stable public methods |
| Capability split | Booking: Creation/Lifecycle/Query; Payment: Manual/Collection/Refund/Query; Room: Query/Mutation | Đã xử lý god-service facade cũ |
| Service Layer + Transaction Script | Entity chủ yếu là persistence model; rule và transition nằm trong service | Mô tả đúng hơn rich-domain DDD |
| Repository + Unit of Work | TypeORM Repository và transaction-scoped EntityManager | Phù hợp transaction MySQL hiện tại |
| Explicit state machine | Booking transition map tại src/module/booking/booking-lifecycle.service.ts:29 | Giữ; không cần State pattern dạng class cho từng state |
| Policy function | src/module/payment/payment-booking-policy.ts | Hợp lý để gom rule thanh toán liên Booking |
| Adapter | VnPayGatewayService và RoomImageStorageService cô lập provider/storage | Giữ; chỉ thêm port khi cần đổi implementation |
| Declarative authorization | AccessTokenGuard, ActorsGuard, RolesGuard và decorators | Giữ; đã tái kiểm DB state/tokenVersion |
| Dependency inversion cục bộ | CustomerAuthorizationReader/UserAuthorizationReader được Auth bind qua DI | Pattern có giá trị thực, không phải abstraction trang trí |

### 4.3. Vấn đề kiến trúc cần hardening

1. Module boundary chưa kín. Booking đăng ký trực tiếp Payment, Room, Customer và
   User entity; Payment cập nhật Booking/RoomCalendar; Room cũng đọc
   Booking/RoomCalendar. Đây không phải runtime cycle, nhưng state liên aggregate
   có nhiều writer.
2. RoomCalendar thuộc package Booking nhưng Booking, Payment và Room đều mutate.
   Data audit chỉ phát hiện sai lệch sau khi xảy ra; nó không thay thế một owner
   ghi dữ liệu duy nhất.
3. Hạ tầng mang giả định single-instance:
   RateLimitGuard dùng Map trong process tại
   src/common/http/rate-limit.guard.ts:18-21; ảnh ghi local filesystem tại
   src/module/room/room-image-storage.service.ts:96-104; cron đăng ký trong mỗi
   process.
4. Route topology không nhất quán giữa /admin, /management và protected method
   trên /v1/rooms. Guard đang bảo vệ nên chưa phải authorization defect. Không
   rename contract trong cleanup; route mới phải theo một convention được chốt.
5. Request DTO dùng field unknown và Swagger decorator; runtime validation nằm
   trong service/common normalizer, không có global ValidationPipe. Không được
   nói input không validate, nhưng phải chốt một convention và test unknown field,
   whitelist, nullable và normalization nhất quán.
6. Validation/helper bị lặp giữa Payment capability và date parser ở Booking,
   Room, Calendar, Dashboard. Chỉ gom sau khi test chứng minh semantics giống
   nhau.
7. Room/image delete chốt DB trước rồi xóa file; lỗi xóa file chỉ được log. DB
   vẫn đúng nhưng có thể có orphan file và chưa có reconciliation job.
8. Dashboard chạy nhiều query song song, không dùng cùng read snapshot. Chỉ xem
   là defect nếu product yêu cầu report point-in-time tuyệt đối.
9. Không có coverageThreshold trong Jest. Coverage hiện được đo nhưng regression
   coverage không tự làm đỏ pipeline.

### 4.4. Mức phình hiện tại

| Capability service | Dòng hiện tại | Hành động |
|---|---:|---|
| PaymentRefundService | 751 | Ưu tiên failure matrix trước khi cân nhắc tách |
| PaymentCollectionService | 587 | Giữ một capability; tăng branch evidence |
| BookingCreationService | 587 | Giữ transaction boundary; không tách cơ học |
| RoomQueryService | 532 | Rà query responsibility và performance |
| RoomTypeService | 470 | Chưa có bằng chứng bắt buộc tách |
| AuthService | 456 | Chưa tách trước khi chốt activation workflow |
| VnPayGatewayService | 437 | Provider adapter hợp lý |
| BookingLifecycleService | 404 | Một state-machine capability |

Không còn facade hơn 1.000 dòng. Số dòng là trigger review, không phải bằng chứng
tự động của sai design pattern.

## 5. Các vấn đề phải đưa vào test plan ngay

| ID | Nhãn hiện tại | Severity | Vấn đề và bằng chứng | Test đầu tiên phải viết |
|---|---|---|---|---|
| WF-RISK-001 | CANDIDATE_DEFECT | P1 | Room status API cho ADMIN mọi transition và STAFF mọi transition không-HIDDEN tại room-mutation.service.ts:326-344; data-audit.ts:116-140 yêu cầu CHECKED_IN ↔ OCCUPIED hai chiều | Checked-in room bị ADMIN/STAFF đổi READY/CLEANING/MAINTENANCE; room không có check-in bị đặt OCCUPIED |
| WF-RISK-002 | CANDIDATE_DEFECT | P1 money | Late VNPay success chỉ xét Payment FAILED EXPIRED/CANCELLED tại payment-collection.service.ts:409-451, không chặn Booking đã PAID hoặc SUCCESS payment khác; DB không unique SUCCESS/booking, invariant ở data-audit.ts:53-64 | Attempt A expire → manual/attempt B success → callback success muộn của A, tuần tự và concurrent |
| WF-RISK-003 | GAP_EVIDENCE | P1 security | Registration tạo Customer ACTIVE tại auth.service.ts:127-135; SEC-008 được repo ghi MITIGATED, NOT CLOSED | Register-new/duplicate → login; activation/pending/OTP chỉ test sau khi có provider và rule duyệt |
| WF-RISK-004 | NEEDS_DECISION | P1 reporting | DTO gọi revenue.total là Gross collected nhưng SQL chỉ cộng Payment còn SUCCESS theo paid_at; refund sau làm số gross kỳ cũ thay đổi | Paid trong kỳ A, refund kỳ B, đọc lại A; chốt gross/net/cash-flow semantics |
| WF-RISK-005 | NEEDS_DECISION | P1 reporting | Dashboard capacity dùng room hiện tại khác HIDDEN, gồm MAINTENANCE; catalog/booking loại MAINTENANCE | Range có maintenance room; chốt sellable, operational hay physical capacity |
| WF-RISK-006 | NEEDS_DECISION | P2 reporting | Occupancy lịch sử lấy current room count/status nhân cả range; repo không có inventory status history | Tạo/xóa/đổi status sau kỳ báo cáo rồi đọc lại kỳ cũ |
| WF-RISK-007 | NEEDS_DECISION | P2 | Amenity audit cũ đã SUPERSEDED: báo cáo nói được xóa khi đang gắn RoomType; code/unit/E2E hiện trả 409 cho tới khi tháo relation | Characterize 409, sau đó product owner duyệt giữ hay đổi |
| WF-RISK-008 | GAP_EVIDENCE | P2 concurrency | User/Customer status dùng read-then-save ở một số path, chưa có deterministic race matrix | Password/profile/status concurrent, kiểm tokenVersion không mất update |
| WF-RISK-009 | NEEDS_DECISION | P2 | Booking check-in có date rule, check-out không chặn early checkout | Early checkout trước ngày kết thúc; không tự chọn expected |
| WF-RISK-010 | NEEDS_DECISION | P2 | Calendar block không cấm ngày quá khứ | Block/unblock past date và chốt operational policy |
| WF-RISK-011 | GAP_EVIDENCE | P2 testing | Payment Collection branch 52,05%; Refund 56,47%; thấp hơn mục tiêu 70% của kế hoạch nguồn | Failure/reject/malformed/duplicate/concurrent provider matrix |
| WF-RISK-012 | BLOCKED_EXTERNAL | P2 integration | Không có controlled VNPay sandbox response channel | Không báo provider integration PASS chỉ từ signed callback local |

Ngoài workflow, release đang bị chặn bởi:

- hai migration pending và schema check FAIL;
- dependency audit High chưa có non-breaking fix hoặc risk acceptance;
- 147 thay đổi Git chưa được chốt, gồm capability/test quan trọng untracked;
- không có CI tái chạy gate trên clean checkout.

## 6. Ma trận kiểm thử bắt buộc cho mọi workflow

Mỗi workflow phải có các cột sau trong report:

| Dimension | Câu hỏi bắt buộc | Loại bằng chứng |
|---|---|---|
| Contract | Method/path/request/response/error có khớp OpenAPI và runtime không? | Contract test + E2E payload |
| Actor/role | Anonymous, sai actor, sai role, đúng role cho kết quả nào? | E2E 401/403/2xx |
| Ownership | Customer có đọc/sửa resource người khác không? | E2E với hai identity |
| Validation | Missing, invalid, boundary, unknown, nullable, normalization? | Unit + E2E boundary |
| Preconditions | Resource/state/payment/date nào phải tồn tại? | Unit state matrix |
| Happy path | Mutation và response đúng gì? | Unit + E2E |
| Failure path | Not found, conflict, provider fail, DB duplicate, timeout? | Unit/integration/E2E |
| Postcondition | Những bảng/field/file nào phải thay đổi hoặc giữ nguyên? | MySQL assertion + filesystem khi áp dụng |
| Rollback | Lỗi giữa workflow có để lại partial state không? | MySQL integration/E2E |
| Replay/idempotency | Request/callback/job lặp có tạo mutation mới không? | Unit + MySQL E2E |
| Concurrency | Hai request cùng lúc có phá invariant không? | Deterministic MySQL barrier/lock test |
| Projection | Public/customer/management có lộ field ngoài allowlist không? | E2E exact field assertions |
| Observability | Log/request ID có đủ, có lộ secret/PII/stack không? | Unit/log capture + E2E |
| Data invariant | data:audit có còn 0 violation sau workflow không? | Command trên test DB |

Test pyramid áp dụng:

- unit: pure rule, normalizer, mapper, transition và provider response mapping;
- MySQL integration: repository query, transaction, row lock, unique/check/FK,
  isolation và rollback;
- HTTP E2E: route, guard, actor, response envelope, OpenAPI contract;
- provider contract: gateway adapter với recorded/synthetic signed payload;
- controlled sandbox: chỉ khi có kênh provider thật;
- performance: EXPLAIN/dataset có kích thước nêu rõ, không suy diễn từ DB nhỏ.

## 7. Chuẩn bị trước khi audit module

### Lượt 0A - Khóa current truth và release baseline

Phạm vi: không sửa business logic.

1. Ghi timestamp, HEAD, toàn bộ git status và Node/npm/MySQL version.
2. Chạy build, lint, unit, coverage, E2E, OpenAPI check, migration show,
   schema check, data audit và production dependency audit.
3. Giải quyết hai migration theo
   docs/DATABASE_MIGRATION_RUNBOOK.md: backup/restore proof, review up/down,
   maintenance window, migration run, schema check, data audit. Không tự apply
   lên DB ngoài test khi chưa có quyền vận hành.
4. Chốt dependency advisory bằng upgrade/override đã kiểm thử hoặc risk
   acceptance có thời hạn; không dùng npm audit fix --force.
5. Đưa reviewed source/test/migration/docs vào một Git baseline có thể tái lập.
6. Clean checkout phải build và chạy lại gate.

Gate thoát:

- schema check PASS;
- migration show không còn pending cho release đang kiểm;
- clean checkout tái lập được kết quả;
- dependency High đã fix hoặc có accepted owner/deadline;
- nếu chưa đạt, domain audit vẫn có thể nghiên cứu nhưng report release phải là
  BLOCKED, không được ghi stable.

Report: docs/audit/workflows/00a-current-baseline.md.

### Lượt 0B - Shared MySQL E2E harness

Không tách cơ học app.e2e-spec.ts trước bước này.

1. Giữ safety guard NODE_ENV=test và tên DB kết thúc bằng _test trước mọi
   migration/insert/truncate/delete.
2. Tạo một bootstrap/migration/cleanup owner chung.
3. Fixture factory phải trả ownership handle và cleanup scope; không dùng ID/token
   do test module trước tạo.
4. Không để nhiều suite tự migrate/truncate cùng DB song song.
5. Di chuyển một nhóm nhỏ, chạy full 41 E2E, rồi mới tiếp tục từng module.
6. Tạo các file theo domain, nhưng mỗi lượt chỉ tách module đang audit.

Gate: 41/41 test cũ vẫn xanh, order ngẫu nhiên hoặc chạy riêng module không phụ
thuộc dữ liệu module trước, safety guard vẫn đỏ với DB không có hậu tố _test.

Report: docs/audit/workflows/00b-e2e-harness-verification.md.

## 8. Thứ tự kiểm thử từng module/capability

### Lượt 1 - Auth

Actual surface: 4 operation tại src/module/auth/auth.controller.ts:43-94.

Workflow bắt buộc:

1. Customer register mới, duplicate email, duplicate phone và duplicate-key race
   đều có external response đúng current contract.
2. Phone/email normalization trước lookup và persistence.
3. Customer login và User login: đúng, sai password, missing, locked,
   passwordless, malformed hash; cùng generic external failure.
4. JWT sign/verify: actor, subject, role, tokenVersion, iat/exp, tamper.
5. AccessTokenGuard reload account state và role; token cũ bị revoke.
6. GET /auth/me cho hai actor, missing/invalid/trailing token.
7. Rate limit register/login, Retry-After, window reset.
8. Kiểm tra OpenAPI 429 của /auth/me có đúng runtime metadata; nếu không, sửa
   contract hoặc policy có regression.
9. Registration → login membership oracle. Nếu activation được duyệt, bổ sung
   pending account, challenge expiry, resend/rate limit, verify và replay.

Known gap: SEC-008 chưa đóng. Không được kết luận Auth registration VERIFIED toàn
phần trước khi có ownership verification hoặc explicit accepted risk.

Report: docs/audit/workflows/01-auth-workflow-verification.md.

### Lượt 2 - User

Actual surface: 4 ADMIN operation tại
src/module/user/user-admin.controller.ts:37-95.

Workflow bắt buộc:

1. ADMIN tạo đúng STAFF; mọi đường create/update đều không cấp ADMIN.
2. List/search/filter/pagination theo role/status.
3. Update fullName/email/phone/password/role; empty body và boundary.
4. Email/phone canonical uniqueness, duplicate-key race, nullable phone.
5. Password reset tăng tokenVersion và revoke token cũ.
6. Lock/unlock transition thật tăng version; idempotent request không tăng.
7. ADMIN không tự khóa hoặc tự hạ quyền.
8. Anonymous, Customer, STAFF bị từ chối.
9. Deterministic race: profile/password/status và hai status request.
10. Response không trả passwordHash/tokenVersion/deletedAt.

Report: docs/audit/workflows/02-user-workflow-verification.md.

### Lượt 3 - Customer

Actual surface: 6 operation ở profile, admin và credential-management controller.

Workflow bắt buộc:

1. Customer đọc/cập nhật chính mình; không truy cập Customer khác.
2. Email/phone nullable, normalization, uniqueness và update rỗng.
3. Stale profile update đồng thời ADMIN lock không được hồi sinh ACTIVE state.
4. Change password: current password, same/new policy, locked account, rollback,
   tokenVersion.
5. ADMIN list/status; transition/idempotency/token revocation.
6. ADMIN/STAFF set initial password cho counter-created passwordless Customer;
   chỉ một lần.
7. Hai request concurrent set initial password.
8. Status-vs-password và status-vs-status concurrency.
9. Exact public/admin response projection.

Report: docs/audit/workflows/03-customer-workflow-verification.md.

### Lượt 4 - Amenity

Actual surface: 2 public + 6 admin operation.

Workflow bắt buộc:

1. Public list/detail chỉ active; invalid/missing/deleted.
2. Admin create/list/detail/update; search/pagination/includeDeleted.
3. Unique name active và soft-deleted, case/collation behavior.
4. Soft-delete, restore, restore active, duplicate restore.
5. Amenity đang gắn RoomType: characterize current 409.
6. Concurrent RoomType setAmenities với Amenity delete.
7. Anonymous/Customer/STAFF mutation bị từ chối.
8. Public detail active và admin update cần E2E riêng.

Tài liệu docs/audit/modules/04-amenity-audit.md:31,44-46 mô tả rule cũ khác
code/unit/E2E hiện tại; đánh dấu SUPERSEDED và yêu cầu product decision trước khi
đổi behavior.

Report: docs/audit/workflows/04-amenity-workflow-verification.md.

### Lượt 5 - RoomType

Actual surface: 2 public + 7 admin operation.

Workflow bắt buộc:

1. Public/admin list và detail với active/deleted visibility.
2. Create/update basePrice, maxGuests 1..100, description nullable và tối đa
   10.000.
3. Unique name kể cả deleted; create/update/restore race.
4. Soft-delete/restore; không xóa khi có active Room.
5. Exact Amenity set: duplicate ID, missing/deleted ID, empty set, sorted result.
6. Concurrent setAmenities; setAmenities-vs-Amenity delete.
7. SoftDelete RoomType đồng thời create/update Room.
8. Query count/N+1 và EXPLAIN trên dataset được ghi rõ.
9. E2E public list và management detail riêng.

Report: docs/audit/workflows/05-room-type-workflow-verification.md.

### Lượt 6A - Room catalog và management query

Workflow bắt buộc:

1. Public list/detail/search loại HIDDEN và MAINTENANCE.
2. Phân biệt catalog visibility với future bookability cho OCCUPIED/CLEANING;
   không tự coi là bug nếu product chưa chốt.
3. Public projection không trả roomNumber/status/audit field; text search không
   dùng roomNumber.
4. Management list/detail thấy operational inventory đúng quyền.
5. Search theo date, guest, price, RoomType và all-selected active Amenities.
6. Reserved/BLOCKED date exclusion, end date exclusive, invalid/reverse/range.
7. Pagination/filter và query plan với dataset thực tế.

Report: docs/audit/workflows/06a-room-query-workflow-verification.md.

### Lượt 6B - Room mutation và state

Workflow bắt buộc:

1. ADMIN create/update/delete; unique room number kể cả deleted.
2. Hard delete chỉ khi không có Booking/Calendar history; file cleanup.
3. ADMIN/STAFF role matrix cho mọi cặp RoomStatus.
4. WF-RISK-001: CHECKED_IN ↔ OCCUPIED invariant.
5. General update đồng thời ADMIN đổi HIDDEN; không cho stale save ghi đè.
6. RoomType delete/update race với Room create/update.
7. Idempotent status và response projection.

Không sửa state policy trước khi test tái hiện và chốt owner giữa Room và Booking.

Report: docs/audit/workflows/06b-room-mutation-workflow-verification.md.

### Lượt 6C - Room calendar

Workflow bắt buộc:

1. List range; exact one row/night; end date exclusive.
2. Block/unblock tối đa 366 ngày; duplicate/overlap; missing Room.
3. Không block đè RESERVED; unblock chỉ xóa BLOCKED.
4. Hai block concurrent và block-vs-booking concurrent.
5. Past-date block là NEEDS_DECISION.
6. Calendar ownership check constraint và rollback.

Report: docs/audit/workflows/06c-room-calendar-workflow-verification.md.

### Lượt 6D - Room image và storage

Workflow bắt buộc:

1. Missing file, MIME khác decoded bytes, malformed/animated/oversized image.
2. Normalize orientation/size và lưu WebP trong managed path.
3. First image tự thành cover; luôn đúng một cover.
4. Concurrent first image, set-cover và delete-cover.
5. DB save/commit fail phải cleanup file vừa tạo.
6. DB delete đúng nhưng filesystem delete fail: log, orphan detection và
   reconciliation decision.
7. External URL không bị xóa như managed file.
8. Multi-replica cần shared/object storage; local path chỉ VERIFIED cho topology
   single-instance/persistent shared volume đã mô tả.

Report: docs/audit/workflows/06d-room-image-workflow-verification.md.

### Lượt 7A - Booking query và creation

Actual surface: customer create/list/detail và management create/list/detail.

Workflow bắt buộc:

1. Customer list/detail chỉ booking của mình; resource khác trả not found.
2. Management list/detail/filter/pagination.
3. Online create: active actor, Room/RoomType active, date, 1..90 night, guest
   capacity, price snapshot, decimal total.
4. Security admission rules hiện tại: tối đa 3 active unpaid booking, 30 held
   room-night, 365 ngày advance; lock Customer trước khi tính quota.
5. Counter create với Customer hiện hữu hoặc passwordless Customer mới; staff
   snapshot.
6. Mỗi night có đúng một RESERVED row và cùng booking/room ownership.
7. Room/date overlap, duplicate unique collision, rollback khi giữa transaction.
8. Hai online/counter booking concurrent.
9. E2E management detail còn thiếu phải bổ sung.

Report: docs/audit/workflows/07a-booking-create-query-verification.md.

### Lượt 7B - Booking lifecycle và expiration

Allowed state matrix hiện tại phải được test đầy đủ:

- PENDING_PAYMENT → CONFIRMED hoặc CANCELLED;
- CONFIRMED → CHECKED_IN hoặc CANCELLED;
- CHECKED_IN → CHECKED_OUT;
- CHECKED_OUT và CANCELLED là terminal.

Workflow bắt buộc:

1. Online UNPAID không được management confirm; counter UNPAID có current
   exception được characterize.
2. Check-in cần PAID, đúng stay date và Room READY; Room thành OCCUPIED.
3. Check-out chuyển Room sang CLEANING trừ HIDDEN/MAINTENANCE.
4. Early check-out là NEEDS_DECISION.
5. Customer cancel: ownership, reason, unpaid only, calendar release, pending
   VNPay fail.
6. Paid cancellation/refund pending bị chặn.
7. Expiry chỉ khóa/đổi đúng PENDING_PAYMENT+UNPAID batch, release calendar.
8. Batch hơn 100 và backlog qua nhiều cron tick.
9. Hai scheduler/process gọi đồng thời không double-mutate.
10. data:audit phải sạch sau từng transition.

Report: docs/audit/workflows/07b-booking-lifecycle-verification.md.

### Lượt 7C - Booking architecture gate

1. Kiểm ownership của Booking/Room/RoomCalendar/Payment mutation.
2. Đo branch từng Creation/Lifecycle/Query, không chỉ facade.
3. Kiểm transaction không mở trước validation thuần không cần DB.
4. Kiểm query count và batch behavior.
5. Chỉ refactor sau characterization; giữ facade/route/response.

Report: docs/audit/workflows/07c-booking-architecture-verification.md.

### Lượt 8A - Payment query và manual payment

Workflow bắt buộc:

1. Customer list chỉ Payment thuộc owned Booking và projection không lộ
   management/refund/gateway field.
2. Management list theo Booking và global list/filter/stale refund count.
3. Manual CASH/BANK_TRANSFER: ADMIN/STAFF, Idempotency-Key bắt buộc, amount
   snapshot, Booking lock, SUCCESS + PAID + auto-confirm.
4. Replay cùng key/same request trả cùng Payment; key khác request bị conflict.
5. Pending VNPay chặn manual payment.
6. Missing/paid/refunded/cancelled/checked-out booking.
7. Hai manual request concurrent; chỉ tối đa một SUCCESS/booking.
8. E2E management Booking-payment list còn thiếu.

Report: docs/audit/workflows/08a-payment-query-manual-verification.md.

### Lượt 8B - VNPay collection, Return, IPN và expiration

Workflow bắt buộc:

1. Create payment: ownership, enabled config, idempotency, one pending attempt,
   stable gateway reference/url/deadline.
2. Signature, TMN, amount, reference, transaction status/date and malformed
   payload matrix.
3. IPN trước Return, Return trước IPN, repeated IPN/Return và concurrent callback.
4. Provider failed response, callback verification exception và DB failure.
5. Pending payment expiry and repeated scheduler.
6. Late success after cancelled Booking → REQUIRES_REVIEW.
7. WF-RISK-002: expired attempt A, then another SUCCESS, then A late success.
8. Unique gateway transaction collision và same transaction across references.
9. Local signed callback chỉ là adapter/integration evidence. Controlled sandbox
   phải được báo BLOCKED_EXTERNAL cho tới khi thật sự chạy.
10. Không log hash secret, raw sensitive payload hoặc internal stack ra client.

Gate: Collection critical branch đạt ít nhất 70% và toàn state/failure row có
evidence; con số 70% không thay thế matrix.

Report: docs/audit/workflows/08b-vnpay-collection-verification.md.

### Lượt 8C - Refund và reconciliation

Workflow bắt buộc:

1. ADMIN-only refund; Idempotency-Key; reason/boundary.
2. Manual refund atomic: Payment REFUNDED, Booking REFUNDED+CANCELLED,
   calendar released.
3. VNPay two-phase: prepare REFUND_PENDING, external call ngoài DB transaction,
   apply verified success/reject/ambiguous.
4. Provider timeout/network/HTTP error/malformed/unverified response.
5. Explicit reject khôi phục exact previous status.
6. Reconcile pending: success, still pending, reject, unverified, repeated.
7. Không gửi refund mutation lần hai khi reconcile.
8. Concurrent refund/refund, refund/callback, refund/Booking lifecycle.
9. Checked-in/checked-out/current state policy.
10. Stale refund visibility và log không lộ secret.

Gate: Refund critical branch đạt ít nhất 70% và provider failure matrix đầy đủ.

Report: docs/audit/workflows/08c-payment-refund-verification.md.

### Lượt 9 - Dashboard

Actual surface: một ADMIN/STAFF summary route.

Workflow bắt buộc:

1. Asia/Bangkok/Vietnam +07:00 boundary, inclusive range, đúng 366 ngày.
2. Booking counts theo status và created_at; empty system.
3. Collected/refunded/review/pending metrics với exact decimal.
4. Paid kỳ A rồi refund kỳ B: chốt Gross, Net hay cash-flow definition.
5. Current Room status metrics.
6. Reserved/BLOCKED room nights; CANCELLED/HIDDEN/deleted.
7. MAINTENANCE trong denominator là NEEDS_DECISION.
8. Thay đổi inventory/status sau kỳ lịch sử là NEEDS_DECISION; nếu cần lịch sử
   chính xác phải có temporal/snapshot model, không sửa SQL vá.
9. Sáu query song song có cần same read snapshot hay eventual consistency được
   chấp nhận?
10. Anonymous/Customer 401/403; ADMIN/STAFF 200.
11. EXPLAIN với dataset đủ lớn và index đã apply; không suy diễn từ một row.
12. FE loading/error/empty/success và browser E2E là BLOCKED_EXTERNAL trong repo BE.

Report: docs/audit/workflows/09-dashboard-workflow-verification.md.

### Lượt 10A - Health và runtime jobs

Workflow bắt buộc:

1. Liveness không gọi DB.
2. Readiness success, acquire timeout, query timeout, DB error và recovery.
3. Concurrent probe cap, connection destroy/release và shutdown.
4. 503/error không lộ hostname, credential, SQL hoặc stack.
5. Readiness rate limit và trusted-network deployment rule.
6. Booking/Payment cron enable/disable, waitForCompletion, structured summary.
7. Hai process cron cùng chạy: lock/idempotency và coordination decision.
8. Stale refund visibility.

Report: docs/audit/workflows/10a-health-runtime-verification.md.

### Lượt 10B - Common HTTP, security và OpenAPI

Workflow bắt buộc:

1. Success/error envelope và status code.
2. Request ID valid/invalid/generate/propagate/log.
3. Helmet, static media nosniff, CORS production allowlist.
4. Actors/Roles metadata, locked/missing/role refresh.
5. RateLimit single-process, proxy IP và multi-replica limitation.
6. Runtime request boundary so với Swagger DTO; unknown field policy.
7. Mọi documented response có schema và mọi runtime payload được validate với
   schema ở representative route mỗi module.
8. Public/customer/management projection exact allowlist.
9. OpenAPI documented status phải có reachable workflow hoặc lý do.

Report: docs/audit/workflows/10b-common-http-openapi-verification.md.

### Lượt 11 - Database và maintenance

Workflow bắt buộc:

1. Migration registration, timestamp order, up/down và baseline backup-only.
2. Apply hai pending migration trên restored/test copy theo runbook.
3. schema check 0 drift; migration show 0 pending cho release.
4. FK, unique, check, index và collation semantics.
5. 10 data-audit query chỉ SELECT; thêm invariant mới nếu defect chứng minh.
6. Seed ADMIN safety.
7. Phone normalization dry-run/apply, invalid/collision, production flag.
8. Migration rollback/restore proof và release log.
9. Query plan Dashboard/catalog/payment trên dataset nêu kích thước.

Report: docs/audit/workflows/11-database-maintenance-verification.md.

### Lượt 12 - Cross-module journeys

Chỉ chạy sau khi các module riêng đã qua gate. Mỗi journey phải kiểm cả API,
database state và data audit:

1. Public catalog → register/login → online Booking → VNPay create → IPN/Return
   → management check-in/check-out.
2. ADMIN tạo STAFF → STAFF tạo counter Booking + passwordless Customer → set
   initial password → Customer login và thấy đúng Booking.
3. Online Booking unpaid → VNPay pending → expiry → calendar release → callback
   muộn.
4. Pending attempt expire → manual/attempt mới success → callback cũ; ưu tiên
   xác minh single-success invariant.
5. Paid Booking → refund request → provider timeout → reconcile → calendar and
   Booking state.
6. CHECKED_IN Booking đồng thời Room status mutation.
7. RoomType/Amenity delete/update đồng thời Room/Booking create.
8. Customer/User lock hoặc password reset giữa request đang chạy; token cũ không
   sống lại.
9. Image mutation lỗi DB/filesystem và cleanup/reconciliation.
10. Dashboard đọc trước/sau payment/refund/inventory change theo semantics đã duyệt.

Report: docs/audit/workflows/12-cross-module-journey-verification.md.

### Lượt 13 - Architecture, hygiene, CI và release

1. Chạy lại AST import graph, runtime cycle, unreachable source và duplicate
   export trên final snapshot.
2. Rà owner của Booking, Payment, RoomCalendar, Room state; mỗi mutation invariant
   có một owner hoặc explicit coordinator/policy.
3. Đo service/method/dependency size; chỉ tách khi có multiple responsibilities
   đã chứng minh và characterization xanh.
4. Rà route convention; không breaking rename trong cleanup.
5. Rà dead/generated/runtime files bằng reachability + compiler + test, không dựa
   riêng git status.
6. Thêm CI tối thiểu: install lockfile, lint, build, unit, OpenAPI drift,
   dependency audit; MySQL service cho migration/schema/data/E2E.
7. Chạy trên clean checkout và lưu artifact/report.
8. Chốt single-instance hay multi-instance. Nếu multi-instance: shared rate
   limit, shared/object image storage, trusted proxy/IP và scheduler coordination.

Report: docs/audit/workflows/13-architecture-release-verification.md.

## 9. Mẫu báo cáo bắt buộc sau mỗi lượt

Mỗi report phải có cấu trúc:

1. Snapshot: timestamp, HEAD, git status, Node/npm/MySQL, env flags không chứa secret.
2. Scope: đúng một module/capability; dependency chỉ đọc.
3. Inventory: controller, route, DTO, service, entity, migration, test.
4. Requirement sources và precedence.
5. Workflow matrix:

| Workflow ID | Route/service | Actor | Preconditions | Happy path | Failure/edge | Postconditions | Evidence | Status |
|---|---|---|---|---|---|---|---|---|

6. State transition matrix:

| Current | Requested/event | Allowed? | Side effects | Rollback invariant | Unit | MySQL E2E |
|---|---|---|---|---|---|---|

7. Authorization matrix:

| Route | Anonymous | Customer | STAFF | ADMIN | Ownership |
|---|---|---|---|---|---|

8. Findings:

| Finding ID | Severity | Label | Expected source | Reproduction | Actual | Impact | Root cause | Fix/test | Status |
|---|---|---|---|---|---|---|---|---|---|

9. Architecture review: responsibility, dependencies, transaction owner, pattern,
   duplication, file hygiene, deployment assumption.
10. Command evidence: exact command, exit code, DB, result, timestamp.
11. Capability result: VERIFIED, PARTIAL, FAIL hoặc BLOCKED; không dùng trung bình
    để che P0/P1.
12. Dependency queue: owner, target round, reason and trigger.

## 10. Gate đóng một module

Module chỉ được đóng khi:

1. Tất cả operation thuộc module đã nằm trong route/workflow matrix.
2. Happy, validation, ownership, authorization và main failure path có test.
3. Mọi state transition allowed/rejected đã được liệt kê.
4. Mutation nhiều bảng có rollback và MySQL E2E.
5. Race/idempotency có deterministic test khi có shared resource.
6. Public/customer/management response dùng exact field allowlist.
7. Runtime payload và OpenAPI không drift.
8. Không còn P0/P1 chưa xử lý.
9. NEEDS_DECISION có quyết định được ghi hoặc module phải giữ PARTIAL.
10. BLOCKED_EXTERNAL không bị giả lập rồi ghi VERIFIED.
11. Targeted và full regression pass trên cùng snapshot.
12. Code/test/report cần thiết có trong Git và clean checkout tái lập được.

Coverage gate:

- toàn project không thấp hơn baseline nếu không có lý do;
- Booking/Payment state capability mục tiêu ít nhất 70% branch theo kế hoạch
  nguồn;
- coverage chỉ là cảnh báo bổ sung; thiếu một state/failure row vẫn FAIL dù đạt
  phần trăm.

## 11. Severity và thứ tự xử lý finding

- P0: mất/sai dữ liệu hoặc tiền, auth bypass đang tái hiện; dừng lượt khác và sửa.
- P1: business, authorization, privacy, transaction hoặc contract defect đã tái
  hiện; sửa trong module trước khi qua gate.
- P2: evidence, maintainability, performance, deployment hoặc observability risk.
- P3: cleanup/docs nhỏ.

CANDIDATE_DEFECT không tự mang severity defect cuối cùng. Viết test tái hiện
trước; nếu expected chưa có nguồn thì chuyển NEEDS_DECISION.

Thứ tự ưu tiên trong từng lượt:

1. data/money/security invariant;
2. authorization/ownership/privacy;
3. transaction/concurrency/idempotency;
4. contract/validation;
5. performance/observability;
6. design cleanup.

## 12. Hướng đi nên giữ và nên tránh

Nên giữ:

- modular monolith và một MySQL transaction boundary cho core booking;
- facade ổn định trước capability service;
- guards/decorators chung;
- VNPay adapter và refund hai pha;
- database constraint kết hợp data audit;
- characterization trước refactor.

Nên tránh:

- chuyển microservice khi aggregate ownership chưa rõ;
- thêm generic repository, mediator hoặc event bus chỉ để có pattern;
- tách service chỉ theo số dòng;
- rename route/response/enum trong cleanup;
- thêm abstraction một implementation không tạo integration/test seam;
- gọi Dashboard lịch sử chính xác khi không có temporal data;
- scale nhiều replica trước shared rate-limit/storage/scheduler design;
- dùng báo cáo PASS ngày cũ thay current command;
- tiếp tục thêm workflow vào app.e2e-spec.ts trước shared harness.

## 13. Definition of Done toàn kế hoạch

Kế hoạch hoàn tất khi:

1. 67 operation hiện tại và mọi non-route scheduler/provider workflow đều được
   trace đến report và evidence.
2. Mọi module/capability Lượt 1-11 qua gate hoặc có BLOCKED_EXTERNAL được owner
   chấp thuận.
3. Hai candidate quan trọng Room occupancy và duplicate-success Payment đã được
   tái hiện rồi sửa/đóng, hoặc test chứng minh không tái hiện với giải thích.
4. Dashboard revenue/occupancy và early checkout/past block có quyết định nghiệp
   vụ rõ.
5. SEC-008 được đóng hoặc có explicit accepted risk và scope.
6. Payment Collection/Refund failure matrix đạt gate.
7. E2E được tách theo domain trên shared safe MySQL harness.
8. migration show, schema check và data audit đều xanh.
9. dependency High được xử lý/risk-accepted.
10. CI chạy gate trên clean checkout.
11. final architecture scan không có runtime cycle/unreachable source không có
    owner.
12. Báo cáo cuối phân biệt rõ: đã đáp ứng, chưa đáp ứng, defect, thiếu evidence,
    decision và external blocker.

Kết luận hiện tại trước khi thực thi: cấu trúc ứng dụng đủ khỏe để tiếp tục theo
hướng modular monolith, nhưng release/operation chỉ ở mức PARTIAL. Việc đúng nhất
tiếp theo là khóa Git/schema baseline, tạo E2E harness an toàn, rồi thực hiện đúng
Lượt 1 → 13; không audit tất cả module trong một lượt và không mở thêm
Booking/Payment feature trước khi hai invariant candidate được kiểm chứng.
