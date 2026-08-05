# Phase 1–9 bootstrap hardening report

Ngày kiểm tra: 2026-08-05  
Repository: `D:\HBMS\homestay-booking-management-system-api`

## 1. Tóm tắt

Đã triển khai các thay đổi trong phạm vi bootstrap, request validation, CORS,
Swagger, request/upload limits, static-cache evidence, logging và Git hygiene.
Các claim dưới đây chỉ dựa trên code/diff và command thực tế.

Đã xác nhận và xử lý:

- Chưa có global request validation; đã bật `ValidationPipe` với
  `whitelist`, `forbidNonWhitelisted`, `transform` và tắt implicit conversion.
- CORS production có hai lớp fail-closed: environment validation và bootstrap
  guard; `credentials` không được bật.
- Swagger trước đây được đăng ký vô điều kiện; nay phụ thuộc
  `SWAGGER_ENABLED`, production mặc định tắt và không persist authorization.
- Body parser production được cấu hình explicit sau khi tạo app với
  `bodyParser: false`; JSON/urlencoded mặc định 1 MB, giới hạn được validate.
- Body-parser/Multer size errors trước đây có thể thành 500; nay trả 413/400
  trong error envelope hiện tại.
- Public room projection thực tế lộ `roomNumber`, trái với E2E/audit contract;
  đã loại trường quản trị khỏi public DTO/response và regenerate OpenAPI.
- Bootstrap dùng Nest `Logger`, không còn `console.log` trong `src/main.ts`.
- 22 file skill agent đã được remove khỏi Git index và giữ local dưới pattern
  ignore; không rewrite history và chưa commit.

Chưa xử lý:

- `npm audit --omit=dev --audit-level=high` còn 2 high qua
  `@nestjs/swagger@11.4.6 -> js-yaml`; `npm audit fix --force` đề xuất thay
  version breaking nên không tự chạy.
- `npm run data:audit` còn 3 vi phạm `stale-refund` trong database local hiện
  tại. Không chỉnh/xóa dữ liệu database để làm đẹp kết quả.
- Query DTO vẫn dùng service/common normalizer để parse số/boolean; không bật
  implicit conversion và chưa thêm `@Type` đại trà vì sẽ đổi semantics của
  query rỗng/chuỗi. Đây là hành vi đã được kiểm tra tĩnh/unit, không phải claim
  rằng mọi query đã được class-transformer chuyển kiểu.

## 2. Thay đổi theo phase

### Phase 1 — Global request validation: Completed

Files: `src/common/http/configure-app.ts`, toàn bộ request DTO dưới
`src/**/dto`, `src/common/http/update-account-status.dto.ts`,
`package.json`, `package-lock.json`.

`class-validator`/`class-transformer` được thêm trực tiếp. Các field hợp lệ
được đánh dấu whitelist bằng `@Allow()` để tương thích với các rule nghiệp vụ
đang nằm ở service/common validator. Global pipe dùng đúng các option đã đề ra;
unknown field bị từ chối, DTO hợp lệ vẫn được transform thành class instance.

Tests: `src/common/http/validation.pipe.spec.ts`, common HTTP E2E kiểm tra
unknown field 400 và valid registration 201. Value/phone/password/date rules
vẫn do service validators sở hữu.

### Phase 2 — Production CORS fail-closed: Completed

Files: `src/config/environment.ts`, `src/config/environment.spec.ts`,
`src/common/http/configure-app.ts`, `src/common/http/configure-app.spec.ts`.

`CORS_ORIGINS` được trim, bỏ chuỗi rỗng, validate HTTP(S) origin và deduplicate.
Production không có allowlist sẽ throw `CORS_ORIGINS is required in production.`;
bootstrap cũng chặn khi bị gọi với config không hợp lệ. Development/test vẫn
cho phép allow-all khi allowlist rỗng. Không có `credentials: true`.

### Phase 3 — Swagger/OpenAPI production gate: Completed

Files: `src/config/environment.ts`, `src/main.ts`, `src/openapi/openapi.ts`,
`src/openapi/openapi.spec.ts`, `scripts/generate-openapi.ts`, `.env.example`,
`.env.test.example`, `README.md`.

`SWAGGER_ENABLED` được parse thành boolean, mặc định true ngoài production và
false trong production. `/api/docs` và `/api/docs-json` chỉ được setup khi
được bật. `persistAuthorization` mặc định false và luôn false trong production.
Generator tạo snapshot trực tiếp nên vẫn chạy khi HTTP docs tắt.

### Phase 4 — Request body/upload limits: Completed

Files: `src/main.ts`, `src/common/http/configure-app.ts`,
`src/config/environment.ts`, `src/common/http/http-exception.filter.ts`,
`src/module/room/room-image-storage.service.ts`, tests và env examples.

JSON/urlencoded limit mặc định là `1mb`, cho phép cấu hình tối đa 50 MB với
format có đơn vị (`kb`, `mb`, `gb`). Main/generator tạo app với body parser tắt
để `configureApp` đăng ký parser explicit. Upload hiện có Multer limits 1 file,
8 MiB và 4 parts; Sharp decode/metadata validation, format allowlist, UUID
filename, `wx` write và path-safe managed storage vẫn được giữ nguyên.

Parser `entity.too.large` trả 413; Multer `LIMIT_FILE_SIZE` trả 413 và các
`LIMIT_*` khác trả 400. Error message không phản hồi stack/nội dung nội bộ.

### Phase 5 — Static image cache correctness: Completed

`RoomImageStorageService` tạo UUID `.webp` mới cho mỗi upload và dùng `flag:
"wx"`, không overwrite URL cũ. Vì invariant này, `immutable`/1 năm trong
`configureApp` là phù hợp. Đã thêm unit test chứng minh replacement tạo URL mới.

### Phase 6 — Bootstrap logging: Completed

`src/main.ts` dùng `new Logger('Bootstrap').log(...)`, chỉ log port; không tự
ghi public localhost URL và không còn `console.log` trong bootstrap.

### Phase 7 — Repository hygiene: Completed (pending commit)

`.gitignore` thêm `.agents/`, `.agent/`, `.codex/`, `.claude/`, `.cursor/`,
`.continue/`, local instruction files và `.aider*`. Trước khi remove đã xác
nhận 22 tracked files chỉ là duplicate Codex Security skill metadata. Chúng đã
được `git rm --cached` (deletion staged), file local vẫn tồn tại và bị ignore.
Không rewrite history, không force-push, không commit.

### Phase 8 — Final verification: Completed with one data-audit exception

Các command bắt buộc đã chạy ở trạng thái code cuối:

| Command | Kết quả | Ghi chú |
|---|---|---|
| `npm ci` | PASS | npm báo deprecated transitive packages; audit install summary có 4 high (dev+prod) |
| `npm run lint` | PASS | ESLint không còn lỗi |
| `npm run build` | PASS | Nest build thành công |
| `npm test -- --runInBand` | PASS | 49 suites / 354 tests |
| `npm run test:e2e -- --runInBand` | PASS | 22 suites / 103 tests; log timeout là fixture VNPay có chủ đích |
| `npm run openapi:check` | PASS | Snapshot current |
| `npm run openapi:validate` | PASS | 5 contract tests pass |
| `npm run schema:check` | PASS | Database schema matches entity metadata |
| `git diff --check` | PASS | Không có whitespace error |
| `npm run data:audit` | FAIL (known data) | 11 pass; `stale-refund` có 3 violation trong DB local |
| `npm audit --omit=dev --audit-level=high` | FAIL (known dependency) | 2 high `js-yaml` qua `@nestjs/swagger`; chưa chạy force fix |

## 3. Danh sách file thay đổi từ `git status --short`

Staged deletions:

```text
D  .agents/skills/codex-security-bulk-scan/SKILL.md
D  .agents/skills/codex-security-export/SKILL.md
D  .agents/skills/codex-security-findings/SKILL.md
D  .agents/skills/codex-security-info/SKILL.md
D  .agents/skills/codex-security-install-hook/SKILL.md
D  .agents/skills/codex-security-login/SKILL.md
D  .agents/skills/codex-security-logout/SKILL.md
D  .agents/skills/codex-security-patch/SKILL.md
D  .agents/skills/codex-security-scan/SKILL.md
D  .agents/skills/codex-security-scans/SKILL.md
D  .agents/skills/codex-security-validate/SKILL.md
D  .claude/skills/codex-security-bulk-scan/SKILL.md
D  .claude/skills/codex-security-export/SKILL.md
D  .claude/skills/codex-security-findings/SKILL.md
D  .claude/skills/codex-security-info/SKILL.md
D  .claude/skills/codex-security-install-hook/SKILL.md
D  .claude/skills/codex-security-login/SKILL.md
D  .claude/skills/codex-security-logout/SKILL.md
D  .claude/skills/codex-security-patch/SKILL.md
D  .claude/skills/codex-security-scan/SKILL.md
D  .claude/skills/codex-security-scans/SKILL.md
D  .claude/skills/codex-security-validate/SKILL.md
```

Unstaged modifications/additions:

```text
M  .env.example
M  .env.test.example
M  .gitignore
M  README.md
M  docs/openapi.json
M  package-lock.json
M  package.json
M  scripts/generate-openapi.ts
M  src/common/http/configure-app.spec.ts
M  src/common/http/configure-app.ts
M  src/common/http/http-exception.filter.spec.ts
M  src/common/http/http-exception.filter.ts
M  src/common/http/update-account-status.dto.ts
M  src/config/environment.spec.ts
M  src/config/environment.ts
M  src/main.ts
M  src/module/amenity/dto/create-amenity.dto.ts
M  src/module/amenity/dto/list-amenities-query.dto.ts
M  src/module/amenity/dto/update-amenity.dto.ts
M  src/module/auth/dto/login.dto.ts
M  src/module/auth/dto/register-customer.dto.ts
M  src/module/booking/dto/cancel-booking.dto.ts
M  src/module/booking/dto/create-booking.dto.ts
M  src/module/booking/dto/create-management-booking.dto.ts
M  src/module/booking/dto/list-bookings-query.dto.ts
M  src/module/booking/dto/list-management-bookings-query.dto.ts
M  src/module/booking/dto/update-booking-status.dto.ts
M  src/module/customer/dto/change-customer-password.dto.ts
M  src/module/customer/dto/list-customers-query.dto.ts
M  src/module/customer/dto/set-initial-customer-password.dto.ts
M  src/module/customer/dto/update-customer-profile.dto.ts
M  src/module/dashboard/dto/dashboard-summary-query.dto.ts
M  src/module/payment/dto/create-manual-payment.dto.ts
M  src/module/payment/dto/create-vnpay-payment.dto.ts
M  src/module/payment/dto/list-payments-query.dto.ts
M  src/module/payment/dto/refund-payment.dto.ts
M  src/module/room-type/dto/create-room-type.dto.ts
M  src/module/room-type/dto/list-room-types-query.dto.ts
M  src/module/room-type/dto/set-room-type-amenities.dto.ts
M  src/module/room-type/dto/update-room-type.dto.ts
M  src/module/room/dto/block-room-dates.dto.ts
M  src/module/room/dto/create-room-image.dto.ts
M  src/module/room/dto/create-room.dto.ts
M  src/module/room/dto/list-available-rooms-query.dto.ts
M  src/module/room/dto/list-management-rooms-query.dto.ts
M  src/module/room/dto/list-rooms-query.dto.ts
M  src/module/room/dto/room-calendar-range-query.dto.ts
M  src/module/room/dto/room-response.dto.ts
M  src/module/room/dto/search-rooms-query.dto.ts
M  src/module/room/dto/update-room-status.dto.ts
M  src/module/room/dto/update-room.dto.ts
M  src/module/room/room-image-storage.service.spec.ts
M  src/module/room/room-query.service.ts
M  src/module/room/room.service.spec.ts
M  src/module/room/room.types.ts
M  src/module/user/dto/create-user.dto.ts
M  src/module/user/dto/list-users-query.dto.ts
M  src/module/user/dto/update-user.dto.ts
M  src/openapi/openapi.ts
M  test/common-http-workflow.e2e-spec.ts
M  test/room-image-workflow.e2e-spec.ts
?? src/common/http/validation.pipe.spec.ts
?? src/openapi/openapi.spec.ts
?? docs/audit/PHASES_1_9_BOOTSTRAP_HARDENING_REPORT.md
```

The report itself is listed above after creation; the agent files are not
listed as untracked because their ignore patterns are active.

## 4. Remaining issues

- **High — dependency:** 2 production audit findings in `js-yaml` pulled by
  `@nestjs/swagger@11.4.6`; only force downgrade is offered by npm and was not
  applied.
- **Medium/operational — local data:** 3 `stale-refund` rows are highlighted by
  `data:audit`; no production/local data was changed by this task.
- **Informational — scaling:** existing in-memory rate limit remains process
  local; this task did not redesign it.

## 5. Environment additions

```env
SWAGGER_ENABLED=false
HTTP_JSON_BODY_LIMIT=1mb
HTTP_URLENCODED_BODY_LIMIT=1mb
```

`CORS_ORIGINS` remains a comma-separated exact-origin allowlist and is required
in production. No secret or actual `.env` value is included in this report.

## 6. Git cleanup conclusion

Patterns were added to `.gitignore`; 22 tracked agent metadata files were
untracked from the index and remain local. No history rewrite, rebase,
force-push, or commit was performed. The staged deletions must be included in a
future user-approved commit.

## 7. Honest conclusion

Các thay đổi đã xử lý những vấn đề được xác nhận trong phạm vi bootstrap,
validation, CORS, Swagger, request/upload limits, static cache, logging và Git
hygiene. Build/lint/unit/E2E/OpenAPI/schema chỉ được gọi là PASS ở các dòng có
command thực sự pass. `data:audit` và production dependency audit vẫn có kết
quả cần xử lý riêng; chúng không bị che giấu hoặc tự động sửa bằng thay đổi
ngoài phạm vi.
