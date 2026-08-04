# Lượt 3 - Audit module Customer

Ngày thực hiện: 2026-07-29  
Trạng thái gate: `PASS`

## 1. Phạm vi

Module được audit/sửa: `src/module/customer`.

Dependency chỉ dùng để xác minh: Auth guard/password hashing, User role guard,
Booking counter-customer fixture và common validation/envelope. Không sửa
business logic dependency.

| Thành phần | Inventory |
|---|---|
| Profile controller/service | 91 / 180 dòng |
| Admin controller/service | 65 / 141 dòng |
| Credential management controller/service | 58 / 124 dòng |
| DTO | profile update, list query, change/initial password, credential response |
| Entity | Customer, nullable email, unique phone/email, soft-delete, status, tokenVersion |
| Test trực tiếp | 3 suite, 22 test |

Customer route:

- Customer actor: `GET/PATCH /api/v1/customers/me`,
  `PATCH /api/v1/customers/me/password`.
- ADMIN: `GET /api/v1/customers`, `PATCH /api/v1/customers/:id/status`.
- ADMIN/STAFF: `PATCH /api/v1/management/customers/:id/initial-password`.

## 2. Use-case matrix

| Use case | Actor/role | Preconditions | Happy path | Failure/edge path | Invariant | Evidence |
|---|---|---|---|---|---|---|
| Read own profile | Customer | Active account/token DB-valid | Trả đúng profile bản thân | Anonymous 401; user 403; missing/locked reject | Không có route đọc customer khác | unit + E2E |
| Update own profile | Customer | Active, unique contact | Normalize name/email/phone, email nullable | Empty 400; duplicate 409; invalid boundary 400 | Không expose credential/admin field | unit + E2E |
| Admin list/filter | ADMIN | Query hợp lệ | Pagination/search/status | STAFF/customer 403; anonymous 401 | Không trả password/tokenVersion | unit + E2E |
| Admin lock/unlock | ADMIN | Target tồn tại | Transition status | ID/status sai; missing | Mỗi transition thật tăng tokenVersion; idempotent không tăng | unit + E2E |
| Change own password | Customer | Active, current password đúng | Lock row, hash mới, tăng version | Sai current/same new/locked/missing | Atomic; token cũ bị thu hồi | unit + MySQL E2E |
| Set initial password | ADMIN/STAFF | Counter customer chưa có password | Lock row, set hash một lần, tăng version | Anonymous 401; customer 403; missing 404; đã có 409 | Concurrent calls được serialize | unit + MySQL E2E |
| Nullable/unique contact | Customer | Email có thể null, phone bắt buộc | Null email; phone canonical | Duplicate variants bị 409 | Normalize trước lookup/save | unit + register/profile E2E |

## 3. Contract, authorization và persistence

- Profile dùng `AccessTokenGuard + ActorsGuard + @Actors('customer')`.
- Admin dùng `AccessTokenGuard + RolesGuard + @Roles('ADMIN')`; initial password
  cho ADMIN/STAFF theo management workflow.
- Controller chỉ xử lý HTTP/envelope; business rule ở ba service nhỏ theo
  capability.
- Response DTO không trả password hash/tokenVersion. Profile response status đã
  siết về `CustomerStatus`.
- Credential mutation chạy TypeORM transaction và
  `pessimistic_write`, ngăn hai initial-password request cùng thắng.
- Entity/migration đã có unique và tokenVersion; lượt này không đổi schema.

## 4. Finding và fix

| ID | Severity | Finding | Fix | Evidence |
|---|---|---|---|---|
| CUSTOMER-001 | P1 | Token trước lock dùng lại được sau unlock vì status không đổi tokenVersion | Tăng version trên transition thật, giữ nguyên cho request idempotent | admin unit + E2E old token 401 |
| CUSTOMER-002 | P2 | Profile update rỗng vẫn save và báo thành công | Reject body không có field normalized | profile unit + E2E 400 |
| CUSTOMER-003 | P1 | Password change chỉ dựa vào guard trước transaction; account có thể bị lock giữa guard và row lock | Kiểm tra lại `LOCKED` sau khi lấy pessimistic lock | credential unit |
| CUSTOMER-004 | P3 | Profile response dùng status `string` | Dùng domain `CustomerStatus` | build/type-check |

Không còn P0/P1 mở trong Customer.

## 5. Verification

| Gate | Kết quả |
|---|---|
| Customer unit | 3 suite, 22/22 PASS |
| Customer targeted coverage | 93,12% statement; 85,91% branch; 92,80% line |
| MySQL E2E | 1 suite, 34/34 PASS |
| Transaction/lock | Unit xác nhận pessimistic lock; E2E initial password một lần |
| Lint/build/full unit/OpenAPI | Chạy lại ở gate tổng sau báo cáo |

## 6. Code size, pattern và hygiene

- Ba capability service đều dưới 200 dòng, dependency nhỏ và controller mỏng.
  Cấu trúc hiện tại đúng hướng; gom lại sẽ làm giảm isolation.
- Không có file chết/trùng đủ evidence để xóa.
- Credential response đang có envelope DTO chuyên biệt trong khi common
  decorator cũng tồn tại; chưa xóa vì file đang được hai controller/OpenAPI dùng.
  Việc thống nhất owner thuộc Common HTTP/OpenAPI lượt 11.
- E2E vẫn monolithic: DQ-003.

## 7. Capability matrix

| Capability/Rule | Status | Evidence | Gap | Fix/Backlog |
|---|---|---|---|---|
| Profile read/update own account | PASS | Unit + E2E | Không | - |
| Admin list/status | PASS | Unit + actor E2E | Không | - |
| Initial password | PASS | Unit + MySQL E2E | Chưa có concurrent E2E hai request | Bổ sung nếu tách E2E Customer |
| Change password/revoke | PASS | Unit + E2E | Không | - |
| Status revoke | PASS | Unit + E2E | Không | CUSTOMER-001 |
| Nullable/unique/normalized contact | PASS | Unit + DB/E2E | Không | - |
| Không truy cập customer khác | PASS | Chỉ có `/me`, actor guard | Không | - |
| E2E tách module | PARTIAL | Flow đầy đủ trong suite | File monolith | DQ-003 |
| Migration mới | N/A | Không đổi schema | Không | - |

## 8. Kết luận

Customer đã đáp ứng profile, admin status/list, credential lifecycle,
normalization/unique và actor isolation. Status/password đều thu hồi token cũ,
credential race có transaction + row lock. Module qua gate; lượt kế tiếp:
`Lượt 4 - Amenity`.
