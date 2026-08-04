# Lượt 13 - Repository hygiene và architecture direction

Ngày thực hiện: 2026-07-29  
Trạng thái backend gate: `PASS`

## 1. Dependency/import graph

Static TypeScript AST scan trên production source và operational scripts:

- 173 file;
- 474 runtime relative-import edge;
- 0 runtime circular dependency;
- 0 file unreachable từ app/CLI/script entry points;
- không dùng `forwardRef`.

Hai cycle entity ban đầu (`Amenity ↔ RoomType`, `Room ↔ RoomImage`) đã được bỏ
bằng type-only import và TypeORM string relation target. Build, schema check và
MySQL E2E xác nhận relation metadata không đổi.

`common`, config và OpenAPI không import ngược domain module. Cross-module
service dependency còn lại là User/Customer dùng `PasswordHasherService` do Auth
sở hữu; không tạo cycle và đúng một security capability.

## 2. Bloat và service structure

`RoomService` là debt cấu trúc còn lại: 767 dòng trộn public/management query,
availability search, mutation, delete-history và status policy. Sau Booking
characterization, đã tách bảo toàn controller contract:

| Thành phần | Trước | Sau | Trách nhiệm |
|---|---:|---:|---|
| Room facade | 767 | 65 | Stable controller API |
| Room Query | - | 442 | Public/management read, search, mapping |
| Room Mutation | - | 358 | Create/update/delete/status và history lock |
| Room shared types | - | 38 | Response/list contracts |

Room targeted 17/17 và full MySQL E2E PASS. Transaction delete/history lock,
image cleanup, route và response không đổi.

Các service lớn nhất còn lại:

| Service | Dòng | Kết luận |
|---|---:|---|
| Payment Refund | 751 | Một refund/reconcile capability; dưới hard ceiling, ưu tiên tăng failure-matrix test trước khi tách tiếp |
| Payment Collection | 587 | Một VNPay collection/callback capability |
| Booking Creation | 497 | Một atomic creation transaction capability |
| RoomType | 470 | CRUD + amenity relation, dưới 500 |
| VNPay Gateway | 437 | Provider adapter/signature/query |
| Booking Lifecycle | 404 | Một transaction state-machine capability |

Controller lớn nhất là `RoomController` 207 dòng; controller chỉ map
HTTP/guard/envelope. Không có bằng chứng cần tách route chỉ theo số dòng.

## 3. Enum và design consistency

Đã thêm owner duy nhất `common/domain/account.enums.ts` cho:

- actor type;
- user role;
- account status.

HTTP payload type, User/Customer entity, validation và Swagger enum đều dẫn xuất
từ owner này. Giá trị API/DB vẫn giữ `customer/user`, `STAFF/ADMIN`,
`ACTIVE/LOCKED`; schema drift bằng 0.

Booking, Payment, Room và calendar tiếp tục dùng domain enum riêng cho state
machine. Facade pattern được giữ tại Booking, Payment và Room để controller
không biết capability split.

## 4. File hygiene

Không dùng `git status` làm bằng chứng file rác. Worktree có 135 entry vì toàn bộ
audit/implementation chưa được commit: 67 modified, 65 untracked và 3 deleted.
AST reachability + compiler xác nhận các source/script mới đều có owner và entry
point.

Ba tracked Nest starter file được xác nhận chết và giữ ở trạng thái deleted:

- `src/app.controller.ts`;
- `src/app.service.ts`;
- `src/app.controller.spec.ts`.

Lý do: không còn import, chỉ phục vụ hello-world starter; thay thế bởi domain
module/Health. Có thể khôi phục từ Git. Build/lint/unit/E2E PASS sau khi bỏ.

`dist`, `coverage`, `.data`, `.tmp` và `node_modules` là generated/runtime
directory đã được `.gitignore` bảo vệ; không xóa dữ liệu local chỉ để làm đẹp
audit. Không có duplicate exported DTO/entity class hoặc production file
unreachable.

Hai tài liệu Phase 1/2 ghi trạng thái cũ đã được cập nhật bằng số liệu hiện tại,
không xóa vì chúng vẫn là roadmap/evidence có owner.

## 5. Capability matrix toàn backend

| Area | Trạng thái | Evidence chính |
|---|---|---|
| Auth | PASS | Token/password/account-state unit + E2E |
| User | PASS | Admin issuance, normalization, revocation |
| Customer | PASS | Profile/credential/status transactions |
| Amenity | PASS | CRUD/soft-delete/relation |
| RoomType | PASS | CRUD, maxGuests boundary, amenity mapping |
| Room/Image/Calendar | PASS | Visibility, search, cover, block/delete/history |
| Booking | PASS | Atomic creation, overlap, lifecycle, expiry |
| Payment/VNPay/Refund | PASS | Verified callbacks, manual/online/refund/reconcile |
| Dashboard backend | PASS | Metric SQL, authorization, index |
| Health/runtime | PASS | Live/ready, scheduler toggle/log/stale refund |
| Common HTTP/security | PASS | Envelope, request ID, Helmet/CORS, guards/rate limit |
| OpenAPI | PASS | 66 operation, missing response schema 0, drift check |
| Database/maintenance | PASS | Migration up/down, schema drift 0, 10 invariants |
| Repository architecture | PASS | 0 runtime cycle, 0 unreachable source/script |
| Frontend contract/browser gate | PARTIAL | Ngoài repository; DQ-001 |

## 6. Final quality gate

- Build: PASS.
- Lint: PASS.
- Full unit: 41 suite, 276/276 PASS.
- Unit coverage: 64,84% statement, 55,00% branch, 67,21% function, 64,98% line.
- MySQL E2E: 36/36 PASS.
- OpenAPI generate/check/contract: PASS, 3/3.
- Test migration state: 14/14 applied.
- Schema drift: 0.
- Data audit: 10/10 PASS.

## 7. Hướng đi tiếp theo

Backend đang đi đúng hướng và không cần chuyển kiến trúc lớn. Không nên thêm
module chỉ vì “project thường có”. Thứ tự công việc tiếp theo theo rủi ro/giá
trị:

1. hoàn tất frontend generated contract + browser gate (DQ-001);
2. backup và apply hai migration pending theo runbook (DQ-010);
3. tăng Payment Collection/Refund provider failure-matrix branch coverage
   (DQ-011);
4. tạo shared E2E DB harness rồi mới tách file E2E monolith (DQ-003);
5. chọn shared rate-limit store chỉ trước khi scale nhiều replica (DQ-009).

Không còn P0/P1 backend chưa xử lý. Các issue còn mở đều có owner và điều kiện
kích hoạt rõ trong dependency queue.
