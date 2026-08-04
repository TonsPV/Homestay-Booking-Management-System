# Lượt 4 - Audit module Amenity

Ngày thực hiện: 2026-07-29  
Trạng thái gate: `PASS`

## 1. Phạm vi và inventory

Chỉ audit `src/module/amenity`; RoomType được đọc để xác minh quan hệ many-to-many.

| Thành phần | Số liệu |
|---|---:|
| Public controller | 43 dòng, 2 route |
| Admin controller | 119 dòng, 6 route |
| Service | 298 dòng, 8 public method, 1 repository dependency |
| DTO | create/update/list/response |
| Entity/migration | unique name, soft-delete, join table RoomType-Amenity |
| Direct test | 1 suite, 9 test |

Public chỉ có list/detail `/api/v1/amenities`. Mutation/list có deleted data nằm
dưới `/api/v1/admin/amenities` và chỉ ADMIN.

## 2. Use case/capability matrix

| Capability/Rule | Status | Evidence | Gap | Fix/Backlog |
|---|---|---|---|---|
| Public list/detail chỉ active | PASS | Unit + E2E delete trả 404 | Không | - |
| Admin CRUD | PASS | Unit + create/delete/restore E2E | Update chủ yếu unit | - |
| Pagination/search | PASS | Unit + public/admin E2E | Không | - |
| Soft-delete/restore | PASS | Unit + E2E | Không | - |
| Unique name kể cả deleted | PASS | Unit + case-insensitive DB E2E | Phụ thuộc DB collation | Được unique index bảo vệ |
| Amenity đang gắn RoomType | PASS | E2E: delete ẩn relation, restore khôi phục relation | Không | - |
| Anonymous/STAFF/customer admin mutation | PASS | E2E 401/403 | Không | - |
| Response/OpenAPI | PASS | DTO riêng, envelope | Không | - |
| E2E tách module | PARTIAL | Flow đầy đủ | File monolith | DQ-003 |

Use-case edge đã kiểm: invalid/missing ID, empty update, duplicate active/deleted,
restore khi chưa xóa, `includeDeleted`, search và nullable description.

## 3. Contract, persistence và design

- Public DTO không có `deletedAt`; admin DTO có.
- TypeORM mặc định loại soft-deleted cho public; admin chỉ gọi `withDeleted`
  khi được yêu cầu.
- Xóa Amenity đang gắn RoomType không xóa join row. RoomType query lọc
  `amenity.deletedAt IS NULL`, vì vậy delete ẩn tiện nghi và restore khôi phục
  association. Đây là behavior hiện tại đã được characterization E2E.
- Unique name được kiểm trước và bắt duplicate-key race.
- Service 298 dòng, một repository, controller mỏng; chưa có bằng chứng phình
  hoặc cần abstraction mới.
- Không phát hiện file chết/trùng đủ điều kiện xóa.

## 4. Finding và thay đổi

Không tái hiện defect P0-P2 trong Amenity. Debt chính là thiếu test trực tiếp,
đã đóng bằng:

- `amenity.service.spec.ts`: 9 test;
- bổ sung E2E STAFF denial, admin deleted detail và include-deleted list.

Không thay đổi business logic, route, response hay persistence.

## 5. Verification

| Gate | Kết quả |
|---|---|
| Amenity unit | 9/9 PASS |
| Targeted coverage | 89,61% statement; 82,14% branch; 89,33% line |
| Lint | PASS |
| MySQL E2E | 34/34 PASS |
| Migration mới | N/A |

Amenity qua gate, không còn P0/P1 và toàn bộ flow bắt buộc có evidence. Lượt kế
tiếp: `Lượt 5 - RoomType`.
