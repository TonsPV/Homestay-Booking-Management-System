# Frontend Integration Roadmap

Tài liệu này là điểm nối giữa Backend và Frontend. Cập nhật tài liệu ngay khi
hoàn thành hoặc thay đổi một module Backend, trước khi bắt đầu màn hình FE tương
ứng.

## 1. FE Nên Dựa Vào Gì?

Không dựa trực tiếp vào entity hoặc cấu trúc database. FE chỉ nên dựa vào API
contract đã được kiểm chứng.

Thứ tự nguồn sự thật hiện tại:

1. API và business rule được mô tả trong `README.md`.
2. Quy ước tích hợp và trạng thái module trong tài liệu này.
3. E2E test cho hành vi thực tế và mã lỗi.
4. Controller/DTO chỉ dùng để Backend kiểm tra chéo, không phải contract cho FE.

Mục tiêu dài hạn:

1. Thêm OpenAPI cho toàn bộ API ổn định.
2. Commit snapshot `openapi.json` cùng Backend.
3. Sinh TypeScript API client từ snapshot cho FE.
4. Mọi thay đổi breaking phải cập nhật OpenAPI, roadmap và changelog trong cùng
   pull request.

OpenAPI baseline hiện có tại `docs/openapi.json`. Room Calendar đã dùng type
sinh từ snapshot; các module cũ tiếp tục dùng type viết tay cho đến khi DTO
OpenAPI của module đó được mô tả đầy đủ. Mỗi module chỉ được xem là FE-ready
khi hoàn thành checklist tại mục 6.

## 2. Global API Contract

### Base URL

- Prefix hiện tại: `/api/v1`
- Không hard-code host trong component. Đọc API origin từ environment của FE.

### Authentication

- Gửi `Authorization: Bearer <accessToken>`.
- Phân biệt hai actor: `customer` và `user`.
- `user` có role `ADMIN` hoặc `STAFF`.
- `401`: token thiếu, sai, hết hạn hoặc đã bị thu hồi.
- `403`: token hợp lệ nhưng actor/role không đủ quyền hoặc tài khoản bị khóa.

### Response envelope

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Thanh cong.",
  "data": {},
  "meta": {
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1
    }
  },
  "path": "/api/v1/example",
  "timestamp": "2026-07-23T13:45:00.007Z"
}
```

- FE đọc dữ liệu nghiệp vụ từ `data`.
- `meta` chỉ xuất hiện khi response có phân trang.
- Không dùng `message` để quyết định logic.
- Error handling dựa trên HTTP status và error payload, không so sánh chuỗi
  message.

### Data types

- ID kiểu `BIGINT` luôn được FE giữ dưới dạng `string`.
- Tiền là decimal string, ví dụ `"900000.00"`. Không dùng JavaScript float để
  cộng/trừ tiền.
- Datetime dùng ISO 8601 UTC có hậu tố `Z`. FE chỉ format sang múi giờ hiển thị.
- Date-only như `checkInDate`, `checkOutDate`, `stayDate` giữ nguyên
  `YYYY-MM-DD`; không đưa qua UTC conversion.
- Phone dùng E.164, ví dụ `+84705840355`.

## 3. Module Readiness

| Module       | Backend       | FE có thể làm                                                                    | Ghi chú                              |
| ------------ | ------------- | -------------------------------------------------------------------------------- | ------------------------------------ |
| Auth         | Ready         | Register, Customer login, Staff/Admin login, session restore                     | Chưa có refresh token                |
| Customer     | Ready         | Customer profile/password, Admin customer list/status                            | Phone dùng E.164; initial password có management API |
| User         | Ready         | Admin cấp tài khoản STAFF, list/update/status                                    | Không cho tạo ADMIN qua API          |
| RoomType     | Ready         | Public catalog, Admin CRUD/restore                                               | Giá trả về decimal string            |
| Amenity      | Ready         | Admin CRUD/restore, gán RoomType, hiển thị và filter public                     | Filter nhiều ID theo logic AND       |
| Room         | Ready         | Public list/search/detail, management list/detail, images/status/calendar blocks | Public không thấy HIDDEN/MAINTENANCE |
| Booking Core | Ready         | Customer booking history/create/cancel, Staff counter booking/management         | Có pending-payment expiry            |
| Payment      | Backend Ready | Customer VNPay/history, Staff manual payment, Admin full refund/reconciliation   | FE đã tích hợp contract refund/query |

## 4. FE Delivery Phases

### Phase 1 - Foundation

- Environment cho API origin.
- HTTP client xử lý response envelope và lỗi chung.
- Lưu session và khôi phục `/auth/me`.
- Route guard theo actor/role.
- Quy ước ID, money, UTC datetime và date-only.
- Layout riêng cho Customer và Management.

### Phase 2 - Authentication And Accounts

- Customer register/login.
- Staff/Admin login.
- Customer profile.
- Customer tự đổi mật khẩu và đăng nhập lại sau khi token cũ bị thu hồi.
- Admin quản lý STAFF và Customer status.
- Xử lý rõ các trạng thái `401`, `403`, `409`, `429`.

### Phase 3 - Room Inventory

- Public RoomType/Room catalog.
- Search theo ngày, số khách, loại phòng và giá.
- Quản lý Amenity, gán theo RoomType và filter phòng phải có đủ các tiện nghi đã chọn.
- Management RoomType/Room.
- Room image file upload, `imageUrl` do Backend trả về, cover image và room
  status.
- Management Room calendar hiển thị `RESERVED`/`BLOCKED`, cho ADMIN/STAFF
  khóa hoặc mở khóa khoảng ngày theo quy ước `[from, to)`. Unblock chỉ xóa
  `BLOCKED`; khi Backend trả `409`, FE reload calendar và availability.

### Phase 4 - Booking Core

- Customer chọn phòng từ kết quả search rồi tạo booking.
- Form mặc định lấy contact từ Customer profile.
- Chỉ gửi contact override khi khách chọn đặt cho người khác.
- Customer xem lịch sử, chi tiết và hủy booking hợp lệ.
- Staff tạo booking tại quầy bằng `customerId` hoặc contact name/phone.
- Staff quản lý status theo transition Backend cho phép.
- Chỉ booking tại quầy do Staff tạo mới được `CONFIRMED + UNPAID`.
- Check-in chỉ khả dụng trong khoảng ngày lưu trú; Room chuyển `OCCUPIED`, rồi
  `CLEANING` khi check-out.
- Khi Backend trả `409`, FE reload availability thay vì tự cho rằng phòng còn
  trống.

### Phase 5 - Payment

- Hiển thị `paymentExpiresAt` cho booking đang chờ thanh toán.
- Customer chỉ đọc lịch sử payment thuộc booking của mình.
- Customer tạo giao dịch VNPay với một `Idempotency-Key` ổn định cho mỗi lần
  bấm thanh toán và chuyển trình duyệt tới `paymentUrl` do Backend trả về.
- `bankCode` là tùy chọn (`VNPAYQR`, `VNBANK`, `INTCARD`); không gửi amount từ
  FE vì Backend lấy tổng tiền từ booking.
- IPN là callback chính. Return hợp lệ có thể cập nhật cùng một transaction
  theo cơ chế fallback; hai callback dùng chung lock và không ghi nhận hai lần.
- Khi có `VNPAY_FRONTEND_RETURN_URL`, Backend redirect Return sang trang kết quả
  FE với `paymentId`, `bookingId` và trạng thái hiện tại. Khi chưa có FE, Backend
  vẫn trả JSON để test bằng browser/Postman.
- Sau Return, FE luôn refetch booking/payment history. Không tự đánh dấu đã
  thanh toán chỉ từ query string hoặc giao diện VNPay.
- Management hiển thị hàng đợi `REQUIRES_REVIEW`; trạng thái này có nghĩa VNPay
  báo thành công sau khi booking đã hủy và cần đối soát/hoàn tiền thủ công.
- Payment `FAILED` với mã `CANCELLED` hoặc `EXPIRED` là attempt VNPay đã bị
  Backend đóng theo vòng đời booking; FE không tự suy luận giao dịch ngân hàng
  chắc chắn thất bại từ hai mã nội bộ này.
- Khi tạo giao dịch trả `409` vì đang có attempt `PENDING`, FE dùng lại payment
  đang hoạt động từ history thay vì tạo thêm request với key mới.
- Staff ghi nhận `CASH` hoặc `BANK_TRANSFER` và gửi một `Idempotency-Key` ổn
  định cho mỗi thao tác.
- Admin thực hiện full refund trước check-in cho manual payment và VNPay.
- Không suy luận `PAID` từ thao tác FE; luôn dùng trạng thái Backend trả về.
- VNPay `REFUND_PENDING` chỉ hiển thị thao tác đối soát; không gửi thêm refund.
- Mỗi refund VNPay gửi một `Idempotency-Key`. Timeout giữ trạng thái pending
  và retry cùng key chuyển sang query/reconciliation.

### Phase 6 - Hardening

- Empty/loading/error states.
- Responsive layout.
- Accessibility và keyboard flow.
- E2E cho các user journey quan trọng.
- Error monitoring và API contract regression.

## 5. Suggested FE Boundaries

Giữ cấu trúc theo domain thay vì gom toàn bộ request vào một file:

```text
src/
  api/                 # HTTP client, envelope, auth header
  auth/                # session and route authorization
  features/
    customers/
    users/
    room-types/
    rooms/
    bookings/
    payments/
  routes/
  shared/
    components/
    formatting/
    validation/
```

- Server data thuộc feature tương ứng.
- UI state cục bộ không đưa vào global store nếu không cần chia sẻ.
- Enum/status mapping đặt một nơi trong feature, không viết string rải rác.
- Component không gọi URL trực tiếp; mọi request đi qua API layer.

## 6. Backend Module Handoff Checklist

Trước khi đánh dấu một module là `Ready`, bổ sung:

- [ ] Actor và role cho từng endpoint.
- [ ] Method và route ổn định.
- [ ] Request body/query mẫu.
- [ ] Response mẫu có đủ field FE cần.
- [ ] Enum và status transition.
- [ ] Ownership rule: ai được xem/sửa record nào.
- [ ] Pagination, search và filter.
- [ ] Mã lỗi dự kiến: `400`, `401`, `403`, `404`, `409`, `429`.
- [ ] Quy ước ID, money, datetime và date-only.
- [ ] E2E cho happy path và business conflict quan trọng.
- [ ] README Backend được cập nhật.
- [ ] Dòng tương ứng trong `Module Readiness` được cập nhật.
- [ ] FE screens và dependency được ghi trong roadmap.

## 7. Module Update Template

Copy block này khi thêm module mới:

```md
### Module Name

- Status: Draft | Backend Ready | FE In Progress | Integrated
- Actors:
- Endpoints:
- Main request:
- Main response:
- Enums/transitions:
- Ownership:
- Expected errors:
- Date/money rules:
- FE screens:
- Depends on:
- Deferred scope:
- Backend E2E:
- FE integration test:
```

## 8. Change Management

### Non-breaking changes

- Thêm endpoint mới.
- Thêm field response optional.
- Thêm filter optional.

FE có thể cập nhật sau mà không cần khóa phiên bản cũ.

### Breaking changes

- Đổi/xóa route hoặc field.
- Đổi kiểu dữ liệu.
- Đổi ý nghĩa status hoặc transition.
- Field optional thành required.
- Thay đổi actor/role hoặc ownership.

Khi có breaking change:

1. Ghi rõ module và màn hình FE bị ảnh hưởng.
2. Cập nhật contract trước khi sửa component.
3. Backend và FE thống nhất thời điểm chuyển đổi.
4. Giữ adapter tạm thời hoặc version endpoint nếu không thể deploy đồng thời.
5. Chạy lại Backend E2E và FE integration test.

## 9. Current Deferred Scope

- Refresh token.
- Hoàn thiện trải nghiệm hàng đợi refund/reconciliation cho management.
- Pricing theo mùa/ngày lễ.
- Generated API client toàn bộ hệ thống từ OpenAPI; hiện Room Calendar đã sinh
  type từ snapshot.

Các mục này không được FE tự mô phỏng trước khi Backend contract được chốt.
