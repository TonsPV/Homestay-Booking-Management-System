# Backend Audit And Delivery Roadmap

Ngay audit: 2026-07-27

Tai lieu nay ghi lai trang thai nghiep vu thuc te cua Backend va thu tu nen
trien khai tiep. Ket luan duoc dua ra tu entity, migration, guard, controller,
service, unit test, E2E test va cac truy van read-only tren database
development; khong dua tren du lieu gia lap trong tai lieu.

## 1. Bang San Sang Hien Tai

| Khu vuc                     | Trang thai            | Ket luan                                                                                                                   |
| --------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Auth                        | Core ready            | JWT phan biet Customer/User, role doc lai tu DB, lock co hieu luc ngay, tokenVersion thu hoi token User/Customer sau doi password |
| User                        | Ready                 | ADMIN cap tai khoan STAFF, quan ly role/status, khong tu khoa hay tu ha quyen chinh minh                                   |
| Customer                    | Ready                 | Dang ky, dang nhap, profile, doi password, initial password tai quay, admin lock/unlock, phone E.164                        |
| RoomType                    | Ready                 | Public read, admin CRUD, soft delete/restore, chan xoa khi con Room dang dung                                              |
| Amenity                     | Ready                 | Public read, admin CRUD/restore, gan theo RoomType va public search yeu cau du tat ca tien nghi                            |
| Room                        | Ready                 | Public/management read tach biet, image upload, cover invariant, status va availability search                             |
| Booking                     | Core ready            | Online/counter booking, calendar transaction, chong trung phong, cancel, expire, check-in/check-out                        |
| Manual Payment              | Ready                 | CASH/BANK_TRANSFER, idempotency, full refund truoc check-in                                                                |
| VNPay Collection            | Ready for Sandbox/MVP | Tao URL, verify Return/IPN, cap nhat idempotent, xu ly callback den muon                                                   |
| VNPay Refund/Reconciliation | Ready for Sandbox/MVP | Full refund hai pha, idempotency, queryDr va khoa Booking trong luc doi soat                                               |
| Room Calendar Management    | Ready                 | ADMIN/STAFF xem lich, khoa/mo khoang ngay; conflict rollback va khong xoa reservation                                      |

Khong can tao module `Role` rieng. Hai role co dinh `ADMIN` va `STAFF` dang dung
enum va guard la phu hop voi pham vi hien tai. Cung khong can tao mot module
`Admin` tong hop; route management va role guard da giu dung ownership theo
domain.

## 2. Bang Chung Kiem Chung

- `npm run build`: pass.
- `npm run lint`: pass.
- Unit test: 11 suite, 59 test pass.
- E2E: 1 suite, 32 test pass tren database co hau to `_test`.
- 12 migration hien co; migration Amenity, calendar ownership va Customer token version
  da duoc kiem chung tren
  database test va development.
- Phone normalization dry-run: 0 thay doi, 0 du lieu sai, 0 collision.
- Production dependencies: `npm audit --omit=dev` bao 0 vulnerability.
- Full dependency tree con 25 high advisory trong toolchain
  Jest/ESLint/Nest CLI (`brace-expansion`/`minimatch`). Khong dung
  `npm audit fix --force` vi lenh nay doi major ESLint; xu ly trong dot nang cap
  dev-tool rieng.

Truy van read-only tren du lieu development hien co:

- Khong co booking active thieu/thua dong `room_calendar`.
- Booking `CANCELLED` khong con giu calendar.
- Khong co booking co nhieu Payment `SUCCESS`.
- Khong co Payment `SUCCESS`/`REFUNDED` lech voi `booking.payment_status`.
- Khong co Room `OCCUPIED` lech voi booking `CHECKED_IN`.
- Moi Room co anh deu co dung mot cover.

## 3. Ton Dong Phai Lam

### P1 - Hoan Thien VNPay Refund Va Reconciliation (Da xong)

Day la ton dong nghiep vu quan trong nhat. Hien tai he thong dung khi admin
khong the hoan tien VNPay bang API cua provider, nhung vi vay booking da thanh
toan VNPay cung khong co luong huy hoan chinh.

Pham vi:

1. Mo rong `VnPayGatewayService` bang `queryDr()` va full `refund()` co san
   trong package `vnpay@2.5.0`.
2. Them trang thai `REFUND_PENDING` va cac field rieng cho refund request,
   response code va provider reference; khong ghi de response code cua giao
   dich thanh toan goc.
3. Yeu cau `Idempotency-Key` cho refund VNPay.
4. Khong giu database transaction trong luc goi HTTP den VNPay:
   - Transaction 1 khoa Payment/Booking va danh dau refund dang xu ly.
   - Goi gateway ben ngoai transaction.
   - Transaction 2 khoa lai va chot ket qua da verify.
5. Chi khi provider xac nhan full refund thanh cong moi dat Payment/Booking
   thanh `REFUNDED`, huy booking va nha `room_calendar`.
6. Neu timeout/ket qua khong ro, giu `REFUND_PENDING` va cho query/reconcile;
   khong tu suy dien thanh cong hay that bai.
7. Cho admin xu ly ca Payment `REQUIRES_REVIEW`.

Test bat buoc:

- Full refund VNPay thanh cong.
- Gateway tu choi refund.
- Timeout khong lam mat trang thai Payment goc.
- Retry cung idempotency key khong gui hai refund.
- Query reconciliation chot mot refund dang pending.
- Khong refund sau check-in/check-out.
- Booking/calendar chi thay doi sau khi provider xac nhan thanh cong.
- Booking bi khoa transition trong luc Payment la `REFUND_PENDING`.
- FE management gui idempotency key, hien refund VNPay va nut reconcile.

### P1 - Room Availability/Blocked Dates (Da xong)

Capability duoc tach thanh `RoomAvailabilityService` trong Room module de
tranh lam `RoomService` lon hon. Migration chi siet invariant ownership:
`RESERVED` phai co booking, `BLOCKED` khong duoc gan booking.

Route de xuat:

- `GET /api/v1/management/rooms/:roomId/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `POST /api/v1/management/rooms/:roomId/blocks`
- `DELETE /api/v1/management/rooms/:roomId/blocks?from=YYYY-MM-DD&to=YYYY-MM-DD`

Rule:

- `ADMIN` va `STAFF` duoc xem/khoa/mo ngay.
- Khoang ngay dung quy uoc `[from, to)`, giong Booking.
- Khoa Room trong transaction, insert tat ca ngay cung luc.
- Unique `(room_id, stay_date)` la chan cuoi cung; trung booking/blocked tra
  `409` va rollback toan bo.
- API mo khoa chi xoa dong `BLOCKED`, khong duoc xoa `RESERVED`.
- Calendar management tra booking code cho dong `RESERVED`, khong lam lo
  password hay field nhay cam.

Test bat buoc:

- Block lam Room bien mat khoi public search.
- Block trung booking va block dong thoi deu bi `409`.
- Rollback toan bo neu mot ngay trong khoang bi trung.
- Unblock tra Room lai ket qua search.
- Unblock khong xoa reservation cua Booking.
- CUSTOMER/anonymous bi chan `403`/`401`.

## 4. Cong Viec Nen Lam Truoc FE

### P2 - OpenAPI Contract (Da co baseline)

- Runtime docs: `/api/docs`; JSON: `/api/docs-json`.
- Snapshot `docs/openapi.json` gom 40 path va 53 operation.
- Room Calendar co request/response schema day du, auth va error contract.
- E2E so sanh document sinh tu code voi snapshot de bat contract drift.
- FE sinh type Room Calendar tu snapshot bang `npm run contract:generate`.

DTO cua cac module cu van can bo sung Swagger property decorator dan dan truoc
khi sinh client cho toan bo API. Khong dung `any` de gia lap phan schema con
thieu.

### P2 - Customer Credential Lifecycle (Da hoan thanh phan local)

- Customer tu doi password; token cu bi thu hoi qua `tokenVersion`.
- ADMIN/STAFF tao password lan dau cho Customer tai quay khi hash con null.
- Khong co public claim account chi bang phone/email.
- Forgot-password/email OTP van de lai den khi co mail provider that; khong fake
  gui mail.

### P2 - Deployment Readiness

- Local Room image storage can persistent volume hoac object storage khi deploy.
- In-memory rate limit chi phu hop mot instance; chua can doi khi chay local.
- Tach E2E lon thanh file theo domain khi them feature moi.
- Khi them refund, tao service rieng; khong tiep tuc don logic vao
  `PaymentService` da hon 1.000 dong.

## 5. Module Mo Rong Sau MVP

Thu tu de xuat, khong phai blocker cho FE core:

1. `Amenity`: da hoan thanh CRUD, RoomType assignment va public filter.
2. `Notification`: email booking/payment; can provider that va outbox/retry toi
   thieu.
3. `Review`: Customer chi review booking `CHECKED_OUT`.
4. `Dashboard/Report`: doanh thu, occupancy, booking status cho management.
5. `Service/Add-on`: chi lam neu de tai yeu cau; module nay anh huong tong tien
   Booking va Payment nen phai thiet ke truoc khi code.
6. `Promotion/Dynamic Pricing`: de sau cung vi lam thay doi price snapshot,
   discount audit va refund.

Khong nen lam ngay refresh token, microservice, event bus, audit platform hay
phan quyen dong theo table Role. Chung lam tang scope nhung khong giai quyet
hai ngo cut nghiep vu hien tai.

## 6. Thu Tu Thuc Thi

1. Bo sung schema OpenAPI day du theo tung module khi module do thay doi.
2. Chon toi da mot module mo rong theo yeu cau do an, uu tien Amenity.
