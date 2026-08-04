# Lượt 2 - Audit module User

Ngày thực hiện: 2026-07-29  
Trạng thái gate: `PASS`

## 1. Phạm vi đã khóa

Module được audit/sửa: `src/module/user`.

Dependency chỉ đọc hoặc dùng làm test fixture:

- Auth: `AccessTokenGuard`, `PasswordHasherService`, token revocation.
- Common HTTP: `RolesGuard`, pagination/status DTO và response envelope.
- Customer: chỉ dùng actor customer đã có để kiểm chứng User route trả 403.

Không sửa business logic Customer. Không đổi route, response shape, enum value
hoặc DB schema.

| Thành phần | Inventory |
|---|---|
| Controller | `user-admin.controller.ts`, 99 dòng, 4 route method |
| Service | `user-admin.service.ts`, 351 dòng, 4 public method, inject Repository + PasswordHasher |
| DTO | create, update, list query |
| Entity | `User`, unique email/phone, soft-delete, role/status enum column, `tokenVersion` |
| Migration | initial users table + `AddUserTokenVersion`, có `up`/`down` |
| Test trực tiếp | `user-admin.service.spec.ts`, 12 test |

Toàn bộ route là management route dưới `/api/v1/users`, dùng
`AccessTokenGuard + RolesGuard + @Roles('ADMIN')`:

- `POST /api/v1/users`
- `GET /api/v1/users`
- `PATCH /api/v1/users/:id`
- `PATCH /api/v1/users/:id/status`

Không có public User route; user login thuộc Auth.

## 2. Use-case matrix

| Use case | Actor/role | Preconditions | Happy path | Failure/edge path | Postconditions/invariant | Evidence |
|---|---|---|---|---|---|---|
| Tạo user | ADMIN | Email/phone chưa dùng, input hợp lệ | Normalize, hash, tạo ACTIVE STAFF | ADMIN role/sai input/trùng unique bị 400/409 | Không thể cấp ADMIN qua create/update API | unit + E2E |
| List/filter | ADMIN | Query hợp lệ | Pagination, search, role/status | Query boundary sai bị 400 | Không trả passwordHash/tokenVersion | unit + E2E |
| Update profile | ADMIN | Target tồn tại | Update tên/email/phone normalized | ID sai/không tồn tại, trùng email/phone, body rỗng | Unique race vẫn map Conflict | unit + E2E empty |
| Reset password | ADMIN | Target tồn tại | Hash mới và tăng `tokenVersion` | Password sai boundary | Mọi token cũ bị 401 | unit + E2E |
| Update role | ADMIN | Target tồn tại | Có thể giữ/demote target thành STAFF | Không cấp ADMIN; không tự hạ quyền | Không có đường privilege escalation | unit + E2E |
| Lock/unlock | ADMIN | Target tồn tại | Đổi status và tăng version khi transition thật | Không tự khóa; status sai | Token trước lock không sống lại sau unlock; request lặp không tăng version | unit + E2E |
| Authorization | ADMIN/STAFF/customer/anonymous | Token và DB account hợp lệ | ADMIN pass | STAFF/customer 403; anonymous 401 | Role luôn đọc lại từ DB | E2E actor matrix |

## 3. Contract, persistence và pattern

- DTO dùng Swagger enum/boundary và service thực hiện validation/normalize.
- Controller chỉ map HTTP sang service và common envelope.
- Response dùng `AuthUserDto`, không expose password hash hay token version.
- Entity có unique index email/phone và soft-delete. Lookup business bỏ
  soft-deleted row nhưng DB unique vẫn bảo vệ race; duplicate DB error được map
  về 409.
- Phone normalize trước unique check và save; email lowercase trước lookup/save.
- Password/status transition tăng `tokenVersion`; guard đối chiếu DB ở mọi
  protected request.
- Không có persistence change trong lượt nên migration mới/transaction là `N/A`.

## 4. Finding và fix

| ID | Severity | Finding | Fix | Evidence |
|---|---|---|---|---|
| USER-001 | P1 | Runtime update nhận `role: ADMIN` dù DTO/OpenAPI chỉ công bố STAFF, cho phép privilege escalation | Tách validator role có thể cấp và chỉ nhận STAFF cho create/update | unit + E2E 400 |
| USER-002 | P1 | Lock rồi unlock không đổi `tokenVersion`, làm token trước khi khóa hoạt động lại | Tăng version trên mỗi status transition thật | unit + E2E old token 401 sau unlock |
| USER-003 | P2 | `PATCH /users/:id` body rỗng vẫn save và báo thành công | Reject 400 khi không có field normalized để update | unit + E2E |

Không còn P0/P1 mở trong User.

## 5. Verification

| Gate | Kết quả |
|---|---|
| User unit | 1 suite, 12/12 PASS |
| User coverage | 87,96% statement; 79,72% branch; 87,73% line |
| Lint | PASS |
| Build | PASS |
| Full MySQL E2E | 1 suite, 34/34 PASS |
| OpenAPI | Không đổi route/DTO shape; full snapshot được kiểm ở gate tổng |

## 6. Phình code, design pattern và file rác

- Service 351 dòng, controller 99 dòng; trách nhiệm CRUD/query/status còn rõ,
  không đạt ngưỡng cần tách.
- Authorization dùng đúng guard/decorator hiện hữu; business rule ở service.
- Không có file không import hoặc DTO/helper trùng đủ bằng chứng để xóa.
- Alias `UserRole/UserStatus` còn trùng owner với Common HTTP; giữ ở DQ-007 để
  xử lý có kiểm soát thay vì đổi chéo module.
- User E2E matrix vẫn nằm trong monolithic test; DQ-003 tiếp tục `IN PROGRESS`.

## 7. Capability matrix

| Capability/Rule | Status | Evidence | Gap | Fix/Backlog |
|---|---|---|---|---|
| ADMIN tạo STAFF, không cấp ADMIN | PASS | Unit + E2E | Không | USER-001 |
| List/search/filter/pagination | PASS | Unit + E2E | Chưa có query-plan lớn | Review performance ở hygiene/database |
| Update profile và normalize | PASS | Unit | Không | - |
| Password reset/revocation | PASS | Unit + E2E | Không | - |
| Lock/unlock và self-protection | PASS | Unit + E2E | Không | USER-002 |
| Email/phone unique | PASS | Unit + DB unique/E2E create | Không | - |
| ADMIN/STAFF/customer/anonymous matrix | PASS | E2E | Không | - |
| Response/OpenAPI envelope | PASS | Decorator/snapshot baseline | Không | - |
| E2E file tách theo module | PARTIAL | Matrix đầy đủ | Còn monolith | DQ-003 |
| Migration/transaction mới | N/A | Không đổi persistence | Không | - |

## 8. Kết luận gate

User đã đáp ứng các flow bắt buộc, bao gồm chặn cấp ADMIN qua API và revocation
không cho token sống lại sau unlock. Ba defect có regression test, không còn
P0/P1, build/lint/unit/E2E đều pass.

Lượt tiếp theo được phép bắt đầu: `Lượt 3 - Customer`.
