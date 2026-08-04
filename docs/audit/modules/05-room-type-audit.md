# Lượt 5 - Audit module RoomType

Ngày thực hiện: 2026-07-29  
Trạng thái gate: `PASS`

## 1. Phạm vi

Audit/sửa `src/module/room-type`; Amenity và Room chỉ được đọc để xác minh relation
và delete constraint.

Inventory: public controller 43 dòng/2 route, admin controller 144 dòng/7 route,
service 471 dòng sau fix/8 public method, 4 request DTO, response DTO, entity
many-to-many và 1 direct spec/14 test.

## 2. Use case và capability

| Capability/Rule | Status | Evidence | Gap | Fix/Backlog |
|---|---|---|---|---|
| Public list/detail active | PASS | Unit + E2E | Không | - |
| Admin list/detail deleted | PASS | Unit + E2E includeDeleted | Không | - |
| Create/update/delete/restore | PASS | Unit + E2E | Không | - |
| `basePrice` boundary/format | PASS | Unit + E2E decimal snapshot | Không | - |
| `maxGuests` 1..100 | PASS | Unit + E2E 101 bị 400 | Không | ROOMTYPE-001 |
| Description nullable/10.000 ký tự | PASS | Validation + E2E empty→null | Chưa E2E max length | Unit/common validator |
| Gán exact Amenity set | PASS | Unit row lock + MySQL E2E | Không | - |
| Deleted/missing/duplicate Amenity ID | PASS | Service default soft-delete filter + E2E | Không | - |
| Không xóa khi active Room dùng | PASS | Unit + DB E2E 409 | Không | - |
| Authorization admin routes | PASS | Existing guard + E2E anonymous/customer; ADMIN pass | STAFF gián tiếp qua cùng RolesGuard | DQ-003 khi tách suite |
| E2E module file | PARTIAL | Flow rộng | Monolith | DQ-003 |

## 3. Finding và fix

| ID | Severity | Finding | Fix | Regression |
|---|---|---|---|---|
| ROOMTYPE-001 | P2 | OpenAPI công bố `maxGuests <= 100`, runtime create/update dùng giới hạn INT | Truyền max 100 vào validation ở cả create/update | 14 unit + E2E `101 => 400` |

Không còn P0/P1.

## 4. Persistence, transaction và pattern

- Entity có unique name, check `max_guests > 0`, `base_price >= 0`, soft-delete.
- Set Amenities chạy transaction và pessimistic lock trên RoomType, kiểm tra đủ
  active ID rồi save exact sorted set.
- Delete kiểm tra active Room trước soft-remove; DB FK giữ relation.
- Query join Amenity lọc `deletedAt IS NULL`, tránh lộ Amenity đã xóa.
- Service 471 dòng ở dưới ngưỡng 500; trách nhiệm còn cohesive. Không tách.
- Không có file rác/trùng được chứng minh.

## 5. Verification

| Gate | Kết quả |
|---|---|
| Direct unit | 14/14 PASS |
| Targeted coverage | 59,82% statement; 53,57% branch; 58,40% line |
| Lint | PASS |
| MySQL E2E | 34/34 PASS |
| Migration mới | N/A |

Coverage tập trung boundary, authorization evidence, delete invariant và
transaction; các mapper/query branch còn được E2E bảo vệ. RoomType qua gate.
Lượt tiếp theo: `Lượt 6 - Room`.
