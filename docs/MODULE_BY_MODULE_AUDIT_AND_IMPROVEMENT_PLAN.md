# HBMS Module-by-Module Audit and Improvement Plan

Ngày lập: 2026-07-29

Phạm vi: Backend NestJS tại `homestay-booking-management-system-api`.

Trạng thái thực thi 2026-07-29: toàn bộ Lượt 0-13 đã hoàn tất và qua backend
gate. Xem `docs/audit/EXECUTION_STATUS.md` và báo cáo từng lượt.

Tài liệu này bổ sung cho `D:\HBMS\PROJECT_AUDIT_AND_IMPLEMENTATION_PLAN.md`.
Roadmap chung vẫn quyết định thứ tự phase sản phẩm; tài liệu này quy định cách
audit và cải thiện code theo từng module.

## 1. Mục tiêu và nguyên tắc

Mỗi lượt chỉ audit một module hoặc một capability nền tảng được chỉ định rõ.
Không audit đồng thời nhiều module và không gom tất cả nhận xét đến cuối đợt.

Mỗi module phải trả lời được:

1. Module đang cung cấp use case nào, cho actor nào?
2. Luồng happy path, failure path và edge case hoạt động ra sao?
3. Module đã đáp ứng đầy đủ, đáp ứng một phần hay chưa có bằng chứng?
4. Authorization, validation, persistence và transaction có đúng không?
5. Test hiện tại có thật sự bảo vệ business rule hay chỉ chạy qua controller?
6. Code có phình, trùng trách nhiệm, phụ thuộc vòng hoặc có file chết không?
7. Thiết kế hiện tại có phục vụ roadmap hay đang thêm abstraction/chức năng
   chưa cần thiết?
8. Cần sửa ngay trong lượt, cần characterization trước refactor, hay phải đưa
   sang backlog có lý do?

Nguyên tắc thực hiện:

- Một lượt, một module. Issue phụ thuộc module khác được ghi vào dependency
  queue, không tự ý mở rộng phạm vi.
- Viết hoặc hoàn thiện characterization test trước khi thay đổi state machine,
  transaction boundary hoặc tách service.
- Không đánh giá bằng cảm giác. Mọi kết luận phải kèm route, test, query, file,
  dòng code hoặc kết quả command.
- Không dùng coverage tổng làm bằng chứng duy nhất. Phải chỉ ra business rule
  nào đã và chưa được bảo vệ.
- Không đổi route, response shape, enum hoặc DB column khi chỉ đang cleanup.
- Không thêm design pattern chỉ để “đẹp kiến trúc”. Pattern phải giải quyết một
  vấn đề đã chứng minh.

## 2. Baseline hiện tại

Baseline đã kiểm chứng gần nhất:

- Migration: 12/12 đã áp dụng.
- OpenAPI: 66/66 operation JSON 2xx có response schema.
- Unit: 14 suite, 70 test pass.
- E2E: 1 suite, 33 test pass trên database `_test`.
- Unit coverage: 22,8% statement, 22,51% line.
- Data audit: 10/10 invariant pass.

### 2.1. Module và điểm cần chú ý

| Module | Service lớn nhất | Unit spec trực tiếp | Nhận định ban đầu |
|---|---:|---:|---|
| Auth | `AuthService` 393 dòng | 0 | Critical security boundary, thiếu unit trực tiếp |
| User | `UserAdminService` 336 dòng | 0 | Cần bảo vệ role/status/self-update |
| Customer | `CustomerProfileService` 175 dòng | 0 | Nhiều luồng credential/token revocation |
| Amenity | `AmenityService` 298 dòng | 0 | CRUD/soft-delete và relation chưa có unit |
| RoomType | `RoomTypeService` 465 dòng | 0 | Assignment/soft-delete/price cần test |
| Room | `RoomService` 767 dòng | 2 | Gần ngưỡng tách; image/calendar có concurrency |
| Booking | `BookingService` 1.083 dòng | 0 | State machine/transaction lớn, ưu tiên cao |
| Payment | `PaymentService` 1.716 dòng | 2 gián tiếp | Điểm phình và rủi ro tiền cao nhất |
| Dashboard | `DashboardQueryService` 315 dòng | 1 | Read-only nhưng metric cần đối chiếu DB |

Các capability nền tảng phải có lượt audit riêng sau domain module:

- Health/runtime;
- common HTTP, guards, envelope, security và OpenAPI;
- database, migration, data-audit, seed và maintenance scripts;
- repository hygiene, dependency direction và file rác.

### 2.2. Nhận định hướng đi ban đầu

Hướng kiến trúc tổng thể đang đúng:

- tổ chức module theo domain;
- tách public và management route;
- dùng guard/decorator chung;
- giữ migration và `synchronize: false`;
- Booking/Payment có transaction, lock và E2E database;
- OpenAPI response contract và operational baseline đã được bổ sung.

Nhưng thứ tự thực thi chưa hoàn toàn đúng roadmap:

- frontend contract migration của Phase 1 còn mở;
- Phase 2 test/service split chưa đạt gate;
- unit coverage trực tiếp của nhiều business service vẫn bằng 0;
- E2E còn dồn trong một file;
- Dashboard/runtime work đã xuất hiện trước khi debt Phase 2 được đóng.

Kết luận ban đầu: không cần đổi hướng sản phẩm hoặc chuyển kiến trúc lớn. Cần
quay lại kỷ luật test-first và module-by-module, theo chuỗi
Auth → User → Customer → Amenity → RoomType → Room → Booking → Payment.
Dashboard và module mới không
được dùng để né test/refactor debt đang tồn tại.

## 3. Mẫu thực hiện bắt buộc cho một lượt audit

Mỗi lượt tạo hoặc cập nhật đúng một báo cáo:

`docs/audit/modules/<NN>-<module>-audit.md`

### Bước A - Khóa phạm vi

- Ghi module được audit và các module chỉ được xem như dependency.
- Liệt kê controller, service, DTO, entity, module provider, test và migration
  liên quan.
- Ghi public route và management route riêng.
- Ghi số dòng service/controller, số public method và dependency được inject.
- Ghi Git status trước khi sửa để không ghi đè thay đổi không liên quan.

### Bước B - Lập bản đồ use case và luồng

Với từng route/use case, lập bảng:

| Use case | Actor/role | Preconditions | Happy path | Failure/edge path | Postconditions/invariant | Evidence |
|---|---|---|---|---|---|---|

Không được bỏ qua:

- anonymous, sai actor, sai role;
- input thiếu/sai định dạng/boundary;
- resource không tồn tại hoặc đã soft-delete;
- trạng thái hiện tại không cho phép transition;
- request lặp/idempotency;
- concurrent request nếu có lock/unique invariant;
- provider timeout/late callback với Payment;
- dữ liệu trả public có bị lộ field quản trị hay không.

### Bước C - Audit contract và authorization

- Request DTO mô tả đúng input và validate/normalize tại boundary phù hợp.
- Response DTO khớp service response, không đưa entity trực tiếp vào Swagger.
- Success/error vẫn nằm trong envelope chung.
- 2xx schema, error quan trọng và example có trong OpenAPI.
- Guard/decorator dùng đúng pattern hiện có:
  `AccessTokenGuard`, `ActorsGuard`, `RolesGuard`, `@Actors`, `@Roles`.
- Public và management route không làm lộ inventory/field khác nhau.
- Có test 401/403 cho route cần bảo vệ.

### Bước D - Audit business rule và persistence

- Business rule nằm ở service, controller chỉ xử lý HTTP.
- Enum được dùng cho status/method/state transition.
- Kiểm tra entity, index, unique, foreign key, check constraint và soft-delete.
- Nếu persistence thay đổi: migration có `up`/`down`, không dùng `synchronize`.
- Booking/Payment/Calendar/Image mutation phải xác định transaction boundary.
- Lock, unique constraint và retry/idempotency phải khớp nhau.
- Không update trạng thái từ callback/provider data chưa xác minh.
- Phone phải normalize trước lookup unique/login/persistence.

### Bước E - Audit test

- Liệt kê business rule hiện có và test đang bảo vệ rule đó.
- Thêm unit test cho rule thuần/service transition.
- Giữ MySQL E2E cho transaction, lock, constraint và concurrency.
- Mỗi rule quan trọng có ít nhất happy path và failure path.
- E2E authorization có anonymous, sai role và role hợp lệ.
- Không sửa test không liên quan chỉ để tăng coverage.
- Khi tách E2E, giữ safety guard:
  `NODE_ENV=test`, database kết thúc `_test`, guard chạy trước mutation.

### Bước F - Audit phình code, pattern và file rác

Đánh giá theo bằng chứng, không tự động kết luận chỉ dựa vào số dòng:

- Service trên 800 dòng: bắt buộc lập phương án tách theo capability.
- Service 500-800 dòng: kiểm tra số trách nhiệm và private helper trước khi tách.
- Method trên khoảng 80 dòng hoặc có nhiều nhánh state: ứng viên extraction.
- Controller chứa query/business rule: phải chuyển về service.
- DTO/entity/response mapper bị trùng: xác định owner, không tạo generic framework.
- Dependency hai chiều hoặc import vòng: ghi P1/P2 tùy ảnh hưởng runtime.
- File không được import, file generated cũ, report sai trạng thái, script trùng,
  DTO không dùng: chỉ xóa sau khi xác nhận bằng `rg`, compiler và test.
- Abstraction chỉ có một implementation và không tạo seam test/integration:
  xem xét đơn giản hóa.
- Facade có thể giữ trong giai đoạn tách service để bảo toàn controller contract.

Mọi file bị xóa phải được ghi:

- lý do xác nhận là file chết/trùng;
- nơi thay thế nếu có;
- khả năng khôi phục từ Git;
- build/lint/test sau khi xóa.

### Bước G - Kết luận capability

Mỗi tiêu chí dùng một trong bốn trạng thái:

- `PASS`: có code và bằng chứng test/runtime.
- `PARTIAL`: có implementation nhưng thiếu flow/test/evidence.
- `FAIL`: sai rule, sai contract hoặc có defect tái hiện được.
- `N/A`: không áp dụng, phải ghi lý do.

Không dùng điểm trung bình để che lỗi critical. Module chỉ qua gate khi:

- không còn P0/P1 chưa xử lý;
- route/actor/use case matrix đầy đủ;
- rule quan trọng có unit test;
- authorization và transaction chính có E2E;
- OpenAPI khớp code;
- lint/build/unit/targeted E2E pass;
- issue defer có owner, phase và lý do.

## 4. Chính sách sửa trong từng lượt

### Sửa ngay trong lượt

- DTO/OpenAPI lệch response thật;
- thiếu guard/decorator hoặc validation rõ ràng;
- bug business rule có phạm vi module và có thể thêm regression test;
- query sai, visibility sai, exception không rõ;
- file chết/trùng đã chứng minh;
- thiếu unit/E2E trực tiếp cho flow đang audit;
- documentation/report ghi sai trạng thái.

### Characterization trước, refactor sau trong cùng module

- tách service lớn;
- đổi transaction/lock boundary;
- thay state machine;
- gom mapper/helper được dùng ở nhiều capability;
- thay query có ảnh hưởng dữ liệu hoặc hiệu năng lớn.

Booking và Payment được phép có nhiều lượt liên tiếp. Ví dụ `Booking-A`,
`Booking-B`, `Booking-C`; mỗi lượt vẫn chỉ làm Booking.

### Không tự ý làm trong lượt

- module sản phẩm mới;
- route/response/enum/DB column không cần cho defect đang audit;
- cross-module framework, event bus hoặc microservice;
- cleanup production data trong schema migration;
- refactor module khác chỉ vì phát hiện khi đang audit dependency.

## 5. Thứ tự audit chi tiết

### Lượt 0 - Baseline và inventory

Không sửa business logic.

- Chạy migration show, data audit, build, lint, unit, E2E, coverage và OpenAPI.
- Chốt Git status, module inventory, route inventory và service size.
- Tạo dependency queue ban đầu.

Gate: baseline có kết quả thật; nếu DB/E2E không chạy được phải ghi blocked.

### Lượt 1 - Auth

Luồng bắt buộc:

- customer register;
- customer login và user login;
- `GET /auth/me`;
- password verification;
- account `LOCKED`;
- DB `tokenVersion` và token revocation;
- phone/email login lookup sau normalize;
- rate limit;
- actor payload customer/user.

Kiểm tra đặc biệt: token payload phải khớp DB hiện tại, không chỉ tin JWT.

Đầu ra tối thiểu: unit test trực tiếp cho `AuthService`,
`AccessTokenService`/guard rule quan trọng và E2E auth failure matrix.

### Lượt 2 - User

Luồng bắt buộc:

- ADMIN tạo STAFF, không cấp ADMIN qua API;
- list/filter;
- update profile/role/password;
- lock/unlock;
- admin không tự hạ quyền hoặc tự khóa sai rule;
- email/phone uniqueness và normalization;
- STAFF/CUSTOMER/anonymous bị từ chối đúng.

### Lượt 3 - Customer

Luồng bắt buộc:

- profile read/update;
- admin list/status;
- set initial password;
- change password;
- token cũ bị thu hồi sau đổi credential/status;
- email/phone nullable/unique/normalized;
- customer không truy cập customer khác.

### Lượt 4 - Amenity

Luồng bắt buộc:

- public chỉ thấy active;
- admin CRUD;
- pagination/search;
- soft-delete/restore;
- unique name;
- behavior khi Amenity đang gắn RoomType;
- anonymous/STAFF không được dùng admin mutation.

### Lượt 5 - RoomType

Luồng bắt buộc:

- public list/detail và admin list/detail;
- create/update/delete/restore;
- `basePrice`, `maxGuests`, description boundary;
- gán Amenity, Amenity bị xóa và duplicate id;
- visibility của RoomType bị xóa;
- relation/index/query N+1.

### Lượt 6 - Room

Luồng bắt buộc:

- public list/detail/search chỉ thấy inventory phù hợp;
- management list/detail;
- create/update/delete;
- status transition theo ADMIN/STAFF;
- availability theo ngày/guest/price/Amenity;
- calendar block/unblock;
- image upload/delete/set-cover;
- invariant đúng một cover;
- concurrent first image/cover change;
- storage cleanup khi DB mutation lỗi hoặc room bị xóa.

Đánh giá `RoomService` 767 dòng: chỉ tách nếu trách nhiệm/query đã được
characterization test bảo vệ.

### Lượt 7A - Booking characterization

Chưa tách service.

- Viết test cho create online/counter;
- date overlap và room calendar lock;
- price snapshot/total amount;
- cancellation;
- management transition;
- check-in/check-out date boundary;
- expiration;
- concurrent/counter booking;
- calendar release invariant.

Gate: state machine có test trực tiếp và invariant transaction vẫn có MySQL E2E.

### Lượt 7B - Booking structure and fixes

- Sửa defect đã chứng minh.
- Tách tuần tự Query, Creation, Lifecycle nếu characterization pass.
- Giữ facade/public method và controller behavior ổn định.
- Mỗi capability extraction chạy full unit/E2E trước bước tiếp theo.

### Lượt 7C - Booking verification

- Audit lại response/OpenAPI.
- Đo branch coverage state machine.
- Kiểm tra service size/dependency/transaction boundary sau refactor.
- Chỉ đóng khi không có regression.

### Lượt 8A - Payment characterization

Chưa tách service.

- manual CASH/BANK_TRANSFER;
- idempotency và duplicate success;
- VNPay create;
- IPN signature/amount/reference/status;
- Return trước/sau IPN;
- late callback sau booking/payment expiry;
- `REQUIRES_REVIEW`;
- refund request;
- provider timeout/ambiguous code;
- reconcile refund;
- callback/refund lặp;
- secret/query signature không bị log.

Gate: state machine và money invariants có test trực tiếp; callback chưa verify
không được đổi trạng thái.

### Lượt 8B - Payment structure and fixes

- Sửa defect có regression test.
- Tách tuần tự Query, Manual, VNPay Collection, Refund.
- Expiration service chỉ điều phối scheduler.
- Giữ facade/controller/route/response ổn định.
- Không tự động retry refund mutation.

### Lượt 8C - Payment verification

- Đo branch coverage state machine.
- Đối chiếu Booking payment status và Payment status.
- Chạy data audit, full E2E và OpenAPI snapshot.
- Kiểm tra log không lộ secret.

### Lượt 9 - Dashboard

Luồng bắt buộc:

- date Việt Nam, inclusive boundary và tối đa 366 ngày;
- booking count theo công thức đã chốt;
- collected theo `paid_at`;
- refunded hoàn tất theo `refunded_at`;
- `REFUND_PENDING`/`REQUIRES_REVIEW`;
- room status;
- occupancy loại CANCELLED, HIDDEN và blocked night đúng công thức;
- zero-room/empty range;
- ADMIN/STAFF pass, CUSTOMER/anonymous fail;
- query plan/index với dữ liệu đủ lớn.

Không đóng Phase Dashboard nếu chưa có FE loading/error/empty/success và browser
E2E trong repository frontend.

### Lượt 10 - Health/runtime

- Liveness không phụ thuộc DB.
- Readiness `SELECT 1`, timeout ngắn, trả 503 khi DB lỗi.
- Không lộ hostname, credential, query nội bộ hoặc stack trace.
- Scheduler enable/disable và structured summary log.
- Stale refund visibility.

### Lượt 11 - Common HTTP, security và OpenAPI

- success/error envelope;
- request ID ở header, response và unexpected-error log;
- Helmet và CORS production allowlist;
- validation boundary;
- rate limit behavior;
- guard/decorator metadata;
- OpenAPI drift/response schema validator;
- không có schema/entity/DTO trùng hoặc không dùng.

### Lượt 12 - Database và maintenance

- migration `up`/`down`, index/FK/check constraint;
- `synchronize: false`;
- migration order và test DB application;
- data-audit chỉ có SELECT;
- seed và phone normalization safety;
- backup/runbook trước production migration;
- orphan, calendar, cover, payment/refund invariant.

### Lượt 13 - Repository hygiene và architecture direction

Chỉ thực hiện sau khi các module đã có báo cáo riêng.

- Lập import/dependency graph và tìm circular dependency.
- Tìm file không import, DTO/helper trùng, report/generated artifact cũ.
- Kiểm tra service/controller size sau refactor.
- Đối chiếu module boundary với roadmap.
- Xóa file rác đã chứng minh, mỗi nhóm xóa chạy build/lint/test.
- Tổng hợp capability matrix toàn hệ thống.
- Chốt module tiếp theo theo giá trị/rủi ro, không theo “project thường có”.

## 6. Capability matrix cuối mỗi module

Mỗi báo cáo phải có bảng:

| Capability/Rule | Status | Evidence | Gap | Fix/Backlog |
|---|---|---|---|---|

Và kết luận:

- Hệ thống đã đáp ứng được gì?
- Chưa đáp ứng gì?
- Có defect hay chỉ thiếu bằng chứng test?
- Module có đang phình hoặc sai responsibility không?
- Pattern hiện tại phù hợp hay đang over-engineering?
- Có file rác/trùng nào đã xác nhận?
- Module đang giúp hay cản roadmap?
- Lượt tiếp theo được phép bắt đầu chưa?

## 7. Severity và ưu tiên xử lý

- `P0`: sai dữ liệu/tiền/security đang xảy ra; dừng mở rộng, sửa ngay.
- `P1`: confirmed business/authorization/contract gap; sửa trong module audit.
- `P2`: maintainability, test, observability hoặc performance risk.
- `P3`: cleanup/documentation nhỏ, không chặn module.

Không tách service chỉ vì P2 về số dòng nếu chưa có characterization test.
Không defer P0/P1 chỉ vì full test hiện vẫn xanh.

## 8. Commands và bằng chứng mỗi lượt

Tối thiểu:

```text
npm run lint
npm run build
npm run test -- <targeted specs> --runInBand
npm run test:e2e -- <targeted specs> --runInBand
npm run openapi:generate        # khi route/DTO thay đổi
npm run migration:show          # khi persistence liên quan
npm run data:audit              # Booking/Payment/Room/DB
```

Cuối lượt phải ghi command nào đã chạy, pass/fail, môi trường và lý do command
chưa chạy. Không ghi “pass” dựa trên kết quả của lượt cũ nếu code đã đổi.

## 9. Cải thiện so với yêu cầu audit ban đầu

Các tiêu chí ban đầu được tăng cường như sau:

- “Kiểm tra từng module” được bổ sung dependency queue và gate thoát module.
- “Kiểm tra luồng” được chuẩn hóa thành use-case/actor/state/error/concurrency
  matrix.
- “Đã/chưa đáp ứng” phải có evidence và phân biệt defect với thiếu test.
- “Phình code/file rác/design pattern” có ngưỡng cảnh báo và quy trình chứng
  minh trước khi xóa/tách.
- “Đi đúng hướng” được kiểm tra ở từng module và tổng hợp lại sau cùng, không
  chờ đến cuối dự án.
- Booking/Payment dùng ba lượt liên tiếp: characterization, refactor, verify.
- Mọi cải thiện code phải đi kèm regression test và module gate, tránh cleanup
  lớn không kiểm soát.

## 10. Trạng thái bắt đầu

Lượt kế tiếp theo kế hoạch này:

`Lượt 0 - Baseline và inventory`, sau đó `Lượt 1 - Auth`.

Không bắt đầu User/Customer/Amenity trong cùng lượt Auth. Issue liên quan được
đưa vào dependency queue để xử lý đúng lượt.
