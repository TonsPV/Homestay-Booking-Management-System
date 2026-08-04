# Lượt 6 - Audit module Room

Ngày thực hiện: 2026-07-29  
Trạng thái gate: `PASS`

## 1. Phạm vi và inventory

Audit `src/module/room`. Booking/RoomCalendar và RoomType/Amenity chỉ được đọc để
xác minh availability, delete-history và visibility.

| Thành phần | Dòng/public method |
|---|---:|
| `RoomService` | 767 / 9 |
| `RoomAvailabilityService` | 260 / 3 |
| `RoomImageService` | 220 / 3 |
| `RoomImageStorageService` | 147 / 2 |
| Public + mutation controller | 207 / 8 route |
| Management controller | 136 / 5 route |
| Image controller | 53 / 2 route |
| Direct specs | 5 suite / 39 test |

## 2. Route/use-case matrix

| Use case | Actor | Happy path | Failure/edge | Invariant/evidence |
|---|---|---|---|---|
| Public list/detail | Anonymous | Chỉ Room/RoomType active, không HIDDEN/MAINTENANCE | Invalid/missing ID | Unit query + E2E visibility |
| Availability search | Anonymous | Date/guest/price/RoomType/all Amenity filters | Invalid date/order/price/IDs; occupied/blocked nights excluded | RoomService unit + MySQL E2E |
| Management list/detail | ADMIN/STAFF | Thấy operational + hidden inventory | Anonymous 401/customer 403 | E2E actor/status filter |
| Create/update/delete | ADMIN | Normalize, unique number, active RoomType | Empty/duplicate/missing; history ngăn delete | E2E + service unit |
| Status transition | ADMIN/STAFF | STAFF operational; ADMIN có HIDDEN | STAFF không vào/ra HIDDEN | Unit + E2E |
| Calendar list/block/unblock | ADMIN/STAFF | Exclusive end-date; exact BLOCKED rows | Range >366, duplicate/reserved conflict; chỉ xóa BLOCKED | Availability unit + MySQL E2E |
| Image upload/delete/cover | ADMIN | Validate/decode WebP, one cover | Missing/invalid file; DB failure cleanup; concurrent first/cover | Image/storage unit + concurrency E2E |
| Hard-delete storage cleanup | ADMIN | Chỉ room không history; cascade DB images rồi xóa managed file | Room có booking/calendar 409 | E2E hard delete + storage behavior |

## 3. Contract, authorization và persistence

- Public và management query tách rõ; management dùng
  `AccessTokenGuard + RolesGuard`.
- Create/update/delete/image chỉ ADMIN; status/calendar cho ADMIN/STAFF với rule
  HIDDEN ở service.
- DTO/response không expose persistence-only fields và OpenAPI có multipart
  binary schema.
- Room number có unique index; RoomCalendar có unique `(room_id, stay_date)`.
- Calendar mutation dùng transaction + pessimistic Room lock. Duplicate key được
  map 409, unblock chỉ delete `BLOCKED`, không xóa reservation.
- Image mutation khóa Room; concurrent first image và set-cover được MySQL E2E
  chứng minh đúng một cover. Storage file được xóa khi DB create rollback; delete
  managed bỏ qua ENOENT và log lỗi storage thay vì làm DB mutation giả thất bại.
- Room delete khóa Room và kiểm tra cả Booking lẫn Calendar history trước remove.

## 4. Finding và thay đổi

Không tái hiện defect P0/P1 trong Room ở lượt này. Khoảng trống lớn là thiếu
characterization trực tiếp:

- thêm `room.service.spec.ts`: public visibility, search boundary/filter,
  create/update và role/status rules;
- thêm `room-availability.service.spec.ts`: exclusive range, 366-day boundary,
  Room lock, unique conflict và unblock giữ RESERVED;
- giữ 2 spec image/storage hiện có.

Không đổi route, response, business state hay DB schema.

## 5. Code size và architecture

`RoomService` 767 dòng có nhiều capability và là ứng viên tách:

1. `RoomQueryService`: public/management list/detail/search;
2. `RoomMutationService`: create/update/status/delete;
3. giữ `RoomService` facade để controller không đổi.

Chưa tách ngay vì delete-history đọc Booking/Calendar và plan yêu cầu
characterization Booking trước khi đổi boundary. DQ-008 có owner sau Booking 7A.
Availability và Image đã là capability service riêng, không gom lại.

Không có file chết/trùng được chứng minh để xóa.

## 6. Capability matrix

| Capability/Rule | Status | Evidence | Gap | Fix/Backlog |
|---|---|---|---|---|
| Public/management visibility | PASS | Unit + E2E | OCCUPIED/CLEANING vẫn public theo behavior hiện tại và bookable future | Không đổi khi chưa có product rule khác |
| Search date/guest/price/Amenity | PASS | Unit + E2E | Chưa query-plan dữ liệu lớn | Lượt DB/hygiene |
| CRUD/unique/history delete | PASS | Unit + E2E | Không | - |
| ADMIN/STAFF status | PASS | Unit + E2E | Không | - |
| Calendar block/unblock | PASS | Unit + MySQL E2E | Không | - |
| Image validation/storage | PASS | Unit + media E2E | Không | - |
| Exactly one cover/concurrency | PASS | MySQL concurrent E2E | Application lock, không có DB partial unique | Lock hiện tại đã serialize Room |
| Service size/pattern | PARTIAL | Characterization đã có | 767 dòng/multiple responsibilities | DQ-008 |
| E2E module file | PARTIAL | Flow mạnh | Monolith | DQ-003 |
| Migration mới | N/A | Không đổi persistence | Không | - |

## 7. Verification

| Gate | Kết quả |
|---|---|
| Room direct unit | 5 suite, 39/39 PASS |
| Targeted coverage | 74,62% statement; 62,70% branch; 74,16% line |
| `RoomService` riêng | 59,79% statement; 57,77% branch; 59,69% line |
| Lint | PASS |
| MySQL E2E | 34/34 PASS |

Không còn P0/P1 và các flow bắt buộc có unit/E2E evidence. Room qua gate. Lượt
tiếp theo: `Lượt 7A - Booking characterization`.
