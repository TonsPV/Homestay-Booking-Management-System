# Lượt 1 - Audit module Auth

## Security Round 4 addendum - 2026-07-30

The original Auth audit below is retained as execution history. The current
contract supersedes its registration/login error rows:

- Customer and User login normalize missing, locked, passwordless and
  wrong-password failures to the same generic `401` response.
- Login always performs real or dummy scrypt verification before rejection.
- Customer registration returns only `{ "accepted": true }` with `201` for
  both new and duplicate identifiers; it no longer returns Customer data or a
  duplicate-specific `409`.
- SEC-008 remains partially open because a real out-of-band ownership
  verification provider and pending activation state do not yet exist.

Ngày thực hiện: 2026-07-29  
Trạng thái gate: `PASS`

## 1. Phạm vi đã khóa

Module được sửa: `src/module/auth`.

Dependency chỉ được đọc để kiểm chứng:

- `User` và `Customer`: trạng thái tài khoản, `tokenVersion`, unique email/phone,
  soft-delete và password hash.
- Common HTTP: response envelope, rate limit và authorization reader.
- Database migrations tạo `token_version`.

Không thay đổi route, response shape, enum value hoặc DB column. Worktree trước
lượt Auth đã có 52 entry thuộc baseline; không reset, restore, stage hoặc ghi đè
thay đổi ngoài phạm vi.

### Inventory

| Thành phần | File/chi tiết |
|---|---|
| Controller | `auth.controller.ts`: 98 dòng, 4 public method |
| Business service | `auth.service.ts`: 399 dòng sau siết type, 3 dependency service/repository chính và 4 public method |
| Token | `access-token.service.ts`: 302 dòng; `access-token.guard.ts`: 90 dòng |
| Password | `password-hasher.service.ts`: 112 dòng |
| Authorization reader | customer 33 dòng; user 34 dòng |
| Request DTO | `RegisterCustomerDto`, `LoginDto` |
| Response DTO | `AuthCustomerDto`, `AuthUserDto`, login và `/me` union DTO |
| Persistence | dùng entity/migration của User và Customer; lượt này không đổi persistence |
| Test trực tiếp | 4 spec, 37 test Auth |

Public route:

- `POST /api/v1/auth/customers/register`
- `POST /api/v1/auth/customers/login`
- `POST /api/v1/auth/users/login`

Route cần token:

- `GET /api/v1/auth/me`

Auth không có management route. Việc register/login là public theo chủ đích và
có rate limit; `/me` dùng `AccessTokenGuard`.

## 2. Bản đồ use case và luồng

| Use case | Actor/role | Preconditions | Happy path | Failure/edge path | Postconditions/invariant | Evidence |
|---|---|---|---|---|---|---|
| Customer register | Anonymous | Input hợp lệ, email/phone chưa dùng | Normalize email/phone, hash password, tạo ACTIVE | Thiếu/sai input; trùng email/phone; DB duplicate race | Chỉ lưu phone canonical, không trả password hash | `auth.service.spec.ts`; E2E register/duplicate |
| Customer login | Anonymous/customer | Account tồn tại, ACTIVE, có password | Lookup email/phone normalized, verify scrypt, ký token theo DB `tokenVersion` | Không tồn tại/sai password: 401; LOCKED/không password: 403; rate limit: 429 | JWT mang đúng customer ID và phiên bản DB | unit Auth/password; E2E locked/normalize |
| User login | Anonymous/user | User tồn tại, ACTIVE | Lookup normalized, verify password, ký role và `tokenVersion` hiện tại | Sai credential: 401; LOCKED: 403; rate limit: 429 | Role và version lấy từ DB, không lấy từ request | unit Auth; E2E reset/relogin/rate limit |
| `GET /auth/me` customer | Customer | JWT hợp lệ, account còn tồn tại/ACTIVE và version khớp | Trả profile customer trong envelope | Anonymous/malformed/revoked: 401; LOCKED: 403 | Không trả password/tokenVersion/admin field | guard unit; E2E actor customer |
| `GET /auth/me` user | STAFF/ADMIN | Như trên | Trả profile user; role được refresh từ DB | Anonymous/malformed/revoked/missing: 401; LOCKED: 403 | Không tin role cũ trong JWT | guard unit; E2E actor user và revoked token |
| Password verification | Auth service | Hash đúng format scrypt hỗ trợ | So sánh constant-time | Hash null/hỏng/tham số ngoài policy/sai password trả false | Hash lỗi không làm login ném lỗi crypto/500 | `password-hasher.service.spec.ts` |
| Token verification | Guard | HS256 signature và claim hợp lệ | Verify signature/header/time/actor/sub rồi đối chiếu DB | Tamper, expiry, future `iat`, `exp <= iat`, `sub` lệch ID bị 401 | Payload JWT không đủ để authorize nếu DB không khớp | token/guard unit; E2E revoked |

Sai role không áp dụng riêng cho `/auth/me` vì endpoint chủ đích cho cả customer
và user. Authorization theo role của các management route thuộc module tương ứng.

## 3. Contract, authorization và persistence

- Request DTO mô tả Swagger; validation/normalization nằm ở service boundary hiện
  hữu. Login giữ alias ẩn để tương thích nhưng OpenAPI chỉ công bố `identifier`.
- Response dùng DTO riêng, không đưa entity trực tiếp vào Swagger. Type
  `status`/`role` đã được siết về domain union thay vì `string`.
- Bốn route đều dùng success/error envelope hiện hữu.
- OpenAPI có schema 2xx và common auth/mutation errors; snapshot generate và
  contract test đều pass.
- Guard đối chiếu account hiện tại, status và `tokenVersion` trong DB. Role user
  được ghi đè bằng role hiện tại từ DB.
- Phone được normalize trước unique check, login lookup và persistence.
- Unique email/phone và `token_version` đã có ở entity/migration. Không có thay
  đổi persistence nên migration/transaction mới là `N/A`.

## 4. Finding và fix

| ID | Severity | Finding tái hiện | Fix | Regression evidence |
|---|---|---|---|---|
| AUTH-001 | P2 | Header `Bearer <token> trailing-data` vẫn được guard nhận vì destructuring bỏ phần dư | Parse đúng một token bằng pattern chặt | guard unit và E2E `/auth/me` |
| AUTH-002 | P2 | JWT ký hợp lệ nhưng `sub` không khớp actor ID, hoặc time window vô lý, vẫn được nhận | Ràng buộc `sub`; kiểm tra `exp > iat`; giới hạn future `iat` với clock skew 60 giây | token unit |
| AUTH-003 | P2 | Hash scrypt hỏng/có cost bất thường có thể ném crypto error hoặc tiêu tốn tài nguyên | Chỉ nhận parameter policy hiện tại, đúng salt/key length; crypto error trả false | password unit |
| AUTH-004 | P3 | Response interface dùng `string` cho status/role dù domain đã có type | Dùng `CustomerStatus`, `UserRole`, `UserStatus` | build/lint/type-check |

Không còn P0/P1 mở trong phạm vi Auth.

## 5. Test và verification

| Gate command | Kết quả |
|---|---|
| Auth targeted unit | 4 suite, 37/37 test PASS |
| Auth targeted coverage | 84,51% statement; 73,68% branch; 84,08% line |
| Full unit | 18 suite, 107/107 test PASS |
| MySQL E2E | 1 suite, 34/34 test PASS |
| Lint | PASS |
| Build | PASS |
| OpenAPI generate | PASS |
| OpenAPI contract | 2/2 test PASS |

E2E vẫn phát log `Simulated VNPay timeout` từ payment failure fixture có chủ
đích; không phải lỗi Auth và toàn bộ suite pass.

## 6. Phình code, pattern và file rác

- `AuthService` dưới 500 dòng và đang có một trách nhiệm nghiệp vụ rõ: register,
  login và current identity. Chưa có bằng chứng cần tách service.
- Token, guard, password hashing và DB authorization reader đã là seam riêng,
  có test trực tiếp; controller chỉ map HTTP/envelope.
- Không phát hiện circular import hoặc file chết/trùng trong Auth đủ bằng chứng để
  xóa. Không xóa file trong lượt này.
- E2E Auth đã có failure matrix nhưng vẫn nằm trong file monolith. Việc tách
  bootstrap có rủi ro chéo suite nên được giữ ở `DQ-003` thay vì refactor ngoài
  mục tiêu defect.
- String union actor/role/status còn nhiều owner chéo module, được ghi `DQ-007`;
  không tự tạo abstraction/enum mới trong Auth.

## 7. Capability matrix

| Capability/Rule | Status | Evidence | Gap | Fix/Backlog |
|---|---|---|---|---|
| Register và normalize customer | PASS | Unit + E2E | Không | - |
| Customer/user login | PASS | Unit + E2E | Không | - |
| Password verification an toàn | PASS | 9 case password unit | Không | AUTH-003 đã fix |
| Account LOCKED | PASS | Unit + E2E customer/protected flow | Không | - |
| DB `tokenVersion`/revocation | PASS | Guard unit + user/customer E2E | Không | - |
| Actor payload customer/user | PASS | Token unit + `/auth/me` E2E | Không | AUTH-002 đã fix |
| Role lấy từ DB hiện tại | PASS | Guard unit | Không | - |
| Rate limit register/login | PASS | Decorator + user login E2E 429/Retry-After | Chưa có distributed store | Không phải yêu cầu hiện tại; đánh giá ở Common HTTP |
| OpenAPI/envelope | PASS | Generate + contract test | Không | - |
| E2E tách riêng theo module | PARTIAL | Failure matrix đã có | Còn trong `app.e2e-spec.ts` | DQ-003 |
| Transaction/migration mới | N/A | Không đổi persistence | Không | - |

## 8. Kết luận gate

Hệ thống Auth đã đáp ứng register/login, normalize identifier, password hashing,
khóa tài khoản, revocation theo DB, actor payload, `/auth/me`, rate limit và
contract OpenAPI bằng test trực tiếp.

Phần chưa đáp ứng hoàn toàn là cấu trúc file E2E theo module và thống nhất owner
enum/type chéo User/Customer/Common HTTP. Đây là debt có owner và không che giấu
defect runtime của Auth.

Lượt Auth qua gate vì không còn P0/P1, các flow bắt buộc có happy/failure
evidence, full regression và OpenAPI đều pass. Lượt kế tiếp được phép bắt đầu:
`Lượt 2 - User`.
