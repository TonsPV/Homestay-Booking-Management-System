# Migration: Custom JWT → @nestjs/jwt + @nestjs/passport (Passport JWT)

> **Mode:** PLANNING ONLY — không sửa production code, không commit, không branch, không PR.
>
> **Scope:** backend `TonsPV/Homestay-Booking-Management-System` (repo hiện tại `D:\HBMS\homestay-booking-management-system-api`). Frontend chỉ verify regression, không sửa production code.

**Goal:** Thay custom JWT crypto (HMAC/base64url/timingSafeEqual tự viết) bằng `JwtService` (@nestjs/jwt) và thay HTTP authentication guard bằng Passport (`@nestjs/passport` + `passport` + `passport-jwt`), tách claims validation và DB principal resolution thành các component độc lập, giữ nguyên 100% behavior contract hiện tại.

**Kiến trúc layer mục tiêu (đã verify khớp codebase thực tế):**

```
TOKEN ISSUANCE:  AuthService → AccessTokenService → JwtService.sign()
TOKEN VERIFICATION:
  HTTP:    strict Bearer extractor → passport-jwt → AccessTokenClaimsValidator
           → AccessTokenPrincipalService → request.user
  Future WS: AccessTokenService.verify() → (cùng 2 layer trên) → socket.data.auth
  HTTP compat adapter: request.user → request.auth (legacy view)
AUTHORIZATION (không đổi): ActorsGuard / RolesGuard đọc request.auth
```

---

## 1. Current architecture (flow thực tế, path đã resolve từ working tree)

Toàn bộ auth nằm ở **`src/module/auth/`** — *không* ở `src/common/http/` (prompt warning đã chính xác; `src/common/http` chỉ chứa infra chung).

### Issuance
- `src/module/auth/auth.service.ts` — `loginCustomer()` (L154), `loginUser()` (L190) gọi `accessTokenService.sign({actorType, customerId|userId, role, tokenVersion})` + `getExpiresInSeconds()` cho `LoginResponse.expiresIn`.
- `src/module/auth/access-token.service.ts` — custom crypto hoàn toàn:
  - `sign(subject)` L28: header `{alg:'HS256', typ:'JWT'}` + payload `{sub, actor_type, iat, exp, customer_id|user_id, token_version, role?}`; base64url tự viết (`encodeJson` L121), HMAC-SHA256 (`signSegments` L149), `timingSafeEqual` (`safeEquals` L155).
  - `verify(token)` L63: split 3 segments → verify signature → **verify header alg/typ** (L79) → parse+shape-check payload (`toAccessTokenPayload` L165: `readString/readNumber/readTokenVersion/readOptionalRole`) → **iat ≤ now+60** và **exp > iat** (L87) → **exp > now** else `Access token has expired.` (L94).
  - Không enforce `nbf` (unknown claim bị bỏ qua — payload chỉ được truy cập qua `toAccessTokenPayload`, mọi claim lạ bị loại bỏ khỏi kết quả).

### HTTP verification
- `src/module/auth/access-token.guard.ts` — `AccessTokenGuard` làm **cả 3 concern trong 1 class**:
  1. Strict Bearer parse: `/^Bearer ([^\s]+)$/` (L32), thiếu/malformed → `401 'Authorization bearer token is required.'`;
  2. `accessTokenService.verify(token)` (crypto + claims);
  3. DB principal: `customerAuthorizationReader.findById()` / `userAuthorizationReader.findById()` → `null` hoặc `tokenVersion` mismatch → `401 Invalid access token.`; `status === 'LOCKED'` → `403 'Tai khoan bi khoa.'`; user: `auth.role = user.role` (refresh role từ DB, L81) → gắn `request.auth = auth` (L84).

### Authorization (đã tách riêng sẵn — giữ nguyên)
- `src/module/auth/guards/actors.guard.ts` — đọc `request.auth.actor_type` vs metadata `@Actors`.
- `src/module/auth/guards/roles.guard.ts` — đọc `request.auth.actor_type/user_id/role` vs metadata `@Roles`.
- `src/module/auth/decorators/current-auth.decorator.ts` — `CurrentAuth` → `request.auth`.

### DB readers (interface đã tách sẵn, rất thuận lợi cho migration)
- `src/module/auth/authorization/customer-authorization-reader.ts` — `findById(id) → {id, status, tokenVersion} | null`.
- `src/module/auth/authorization/user-authorization-reader.ts` — `findById(id) → {id, role, status, tokenVersion} | null`.
- Implementations: `customer-authorization.service.ts`, `user-authorization.service.ts` (TypeORM `findOneBy`).

### Wiring
- `src/module/auth/auth.module.ts` — providers/exports: `AccessTokenService`, `AccessTokenGuard`, `ActorsGuard`, `RolesGuard`, readers. Feature modules import `AuthModule` (vd `room.module.ts` L37) và dùng `@UseGuards(AccessTokenGuard, RolesGuard|ActorsGuard)` trên controller.
- Không có global auth guard; public routes không dùng guard.
- `src/common/http/request.types.ts` — `AppRequest<TAuth>` có `auth?: TAuth`; `AuthenticatedRequest` = `AppRequest<AccessTokenPayload> & {auth}`.
- `src/common/http/request-context.decorator.ts` — `ReqContext` expose `auth: unknown` (log/telemetry).
- `src/config/environment.ts` L18-42: secret ≥ 32 ký tự + blocklist, `JWT_ACCESS_TOKEN_EXPIRES_IN` default `'1h'` validate bằng `isPositiveDuration`. `src/config/duration.ts`: grammar `^(\d+)([smhd])?$` (bare number = giây), reject `1.5h/1w/1ms/Infinity`.

### Users của AccessTokenGuard (13 controllers, exact list cho Phase 4)
| Controller | Guard combo |
|---|---|
| `auth.controller.ts` (GET me) | AccessTokenGuard |
| `booking.controller.ts` (5 routes) | + ActorsGuard |
| `booking-management.controller.ts` | + RolesGuard |
| `customer-profile.controller.ts` | + ActorsGuard |
| `customer-admin.controller.ts` | + RolesGuard |
| `customer-credential-management.controller.ts` | + RolesGuard |
| `user-admin.controller.ts` | + RolesGuard |
| `room.controller.ts` (5 routes) | + RolesGuard |
| `room-management.controller.ts` | + RolesGuard |
| `room-image.controller.ts` | + RolesGuard |
| `room-type-admin.controller.ts` | + RolesGuard |
| `amenity-admin.controller.ts` | + RolesGuard |
| `payment.controller.ts` | + ActorsGuard |
| `payment-management.controller.ts` | + RolesGuard |

`CurrentAuth` dùng tại: auth, user-admin, booking, booking-management, customer-admin, customer-profile, payment, payment-management controllers.

## 2. Current behavior contract (bắt buộc preserve)

1. **Token contract:** HS256; header `typ: JWT`; claims `sub, actor_type('customer'|'user'), customer_id|user_id, token_version(≥0 int), role?('STAFF'|'ADMIN' chỉ user), iat, exp`; `sub = customer:<id>` / `user:<id>`; ID là string (UUID v4 của TypeORM).
2. **Header parsing:** regex `^Bearer ([^\s]+)$` — reject `Basic xxx`, `bearer xxx`, `BEARER xxx`, `Bearer` (không token), `Bearer <space><space>token`, leading/trailing whitespace, extra data. Tất cả → `401 Authorization bearer token is required.` (e2e đã assert `'Bearer <token> trailing-data'` → 401).
3. **Claims validation:** iat/exp phải integer; `iat ≤ now+60`; `exp > iat`; `exp > now` (message riêng `Access token has expired.`); actor_type hợp lệ; ID non-empty string; sub match actor+ID; token_version non-negative int; role nếu tồn tại ∈ {STAFF, ADMIN}; bất hợp lệ → `401 Invalid access token.` Mọi failure khác expired đều cùng message `Invalid access token.` — giữ nguyên (không thêm error granularity vào response).
4. **Principal resolution:** account phải tồn tại (401), `token_version` JWT phải == DB (401), `LOCKED` → **403** `Tai khoan bi khoa.` (e2e assert 403 cho locked customer), user role được refresh từ DB trước khi gắn vào `request.auth`.
5. **Error propagation:** DB/system error phải bubble (không nuốt thành 401).
6. **Config:** `JWT_ACCESS_TOKEN_SECRET`, `JWT_ACCESS_TOKEN_EXPIRES_IN` không đổi; duration semantics giữ nguyên (bare `1` = 1 giây).
7. **No `nbf` enforcement** hiện tại — migration không được bắt đầu enforce.
8. **Existing tests phải pass:** `test/unit/module/auth/access-token.service.spec.ts` (194 dòng), `access-token.guard.spec.ts` (179), `auth.service.spec.ts` (400), `test/auth/auth-workflow.e2e-spec.ts` (447 — assert cả message-level contract).

## 3. Technical debt

**Must fix (trong scope migration):**
- Custom HMAC/base64url/verify code (~160 dòng) duy trì bằng tay → thay bằng `JwtService`.
- `AccessTokenGuard` gom 3 concern (header parse + crypto + claims + DB principal) → tách thành ClaimsValidator + PrincipalService + Passport adapter.
- Không có extracted unit-test surface cho claims invariants (chỉ test được qua serviceverify end-to-end).

**Should fix (không làm trong migration này — follow-up):**
- `AccessTokenPayload` optional-field shape (`customer_id?`) khiến guard phải re-check undefined sau khi verify — principal type mới sẽ siết.
- `getMe()` tra cứu DB lần 2 sau khi guard đã lookup (duplicate query trên /auth/me) — §16 của đề bài cấm tối ưu trong migration.

**Optional:**
- Bắt đầu enforce `nbf` (security hardening riêng).
- Nới Bearer grammar (không cần).

## 4. Target architecture

```
                         TOKEN ISSUANCE
                            AuthService
                                 │
                                 ▼
                      AccessTokenService ──► JwtService.sign()   [HS256, typ JWT]
                                 │
        ┌────────────────────────┴─────────────────────────┐
        │ TOKEN VERIFICATION (HTTP)                        │ TOKEN VERIFICATION (future WS)
        ▼                                                  ▼
 strict Bearer extractor                          AccessTokenService.verify()
        │                                                  │
    passport-jwt                                           │
  (HMAC, exp, alg)                                         │
        │                                                  │
        ▼                                                  │
 JwtStrategy.validate(completeJwt)                         │
        │  header.alg/typ check                            │
        ▼                                                  │
 AccessTokenClaimsValidator   ◄────────────────────────────┘
 (pure, sync, no DB/HTTP)
        │ AccessTokenPayload
        ▼
 AccessTokenPrincipalService.resolve()
 (DB qua readers; no crypto/HTTP)
   ├─ Customer: exists, tokenVersion, !LOCKED
   └─ User:     exists, tokenVersion, !LOCKED, role=DB
        ▼
 AuthenticatedPrincipal (discriminated union)
        │
   request.user (canonical Passport principal)
        │
 compat adapter (AuthPrincipalAdapter)
        │
   request.auth (legacy AccessTokenPayload-compatible view, deterministic)
        │
   ┌────┴──────────────┐
 ActorsGuard        RolesGuard          (unchanged)
```

## 5. Responsibility map

| Component | Responsibility | Must not do |
|---|---|---|
| `AccessTokenService` | issuance, JWT verify facade (JwtService), duration config | query DB, resolve role, check LOCKED, depend on Request/Socket |
| `AccessTokenClaimsValidator` (mới) | validate decoded payload structure: sub/actor_type/IDs/token_version/role/iat/exp, iat≤now+60, exp>iat; sync, pure | DB, HTTP, Socket, ORM, HMAC |
| `AccessTokenPrincipalService` (mới) | resolve principal: readers, exists, tokenVersion match, LOCKED→403, user role = DB | parse JWT, verify HMAC, parse Authorization header, depend on ExecutionContext/Request/Socket |
| `JwtStrategy` (mới) | Passport HTTP adapter: nhận token từ extractor, nhờ passport-jwt verify crypto, check header alg/typ, gọi validator + principal service, return principal | role authorization, route metadata, sign JWT, DB branching logic lớn |
| `JwtAuthGuard` (mới) | `canActivate` → `super.canActivate` → map lỗi; gắn `request.user`; chạy compatibility adapter gắn `request.auth` | authorization logic, metadata |
| `StrictBearerExtractor` (mới) | extract token theo `^Bearer ([^\s]+)$` | nới grammar |
| `AccessTokenGuard` (cũ) | giữ nguyên đến Phase 4/5, sau đó deprecate/xoá | — |
| `ActorsGuard` | actor authorization (metadata @Actors) | authentication |
| `RolesGuard` | role authorization (metadata @Roles, dùng `request.auth.role` = DB role) | authentication, DB lookup |
| `CurrentAuth` | param decorator → `request.auth` (compat) | — |
| `AuthService` | login/register/me orchestration | gọi JwtService trực tiếp (phải qua AccessTokenService) |

## 6. Migration phases chi tiết

> Lệnh test: unit = `npm run test`, e2e = `npm run test:e2e` (cần MySQL — `.env.test`), lint = `npm run lint`, build = `npm run build`.
> Mỗi phase KHÔNG commit nếu chưa được yêu cầu; chỉ chạy tests.

### Phase 0 — Characterization tests (đóng băng behavior)
**Goal:** Executable-test toàn bộ behavior contract §2 trước khi đụng production code.
**Files:** chỉ test mới:
- `test/unit/module/auth/access-token.characterization.spec.ts` — dùng `AccessTokenService` thật + `signPayload()` helper (mẫu từ `access-token.service.spec.ts` L180) để forge token signed-đúng với payload sai:
  wrong signature, wrong alg (`none`/`HS512`), wrong typ, malformed (2/4 segments, base64 hỏng, JSON hỏng), missing/invalid iat, iat=now+60 (đậu) vs now+61 (rớt), missing/invalid exp, exp≤iat, expired (message `Access token has expired.`), invalid actor_type, empty ID, sub mismatch, missing/negative/non-integer token_version, invalid role, unknown extra claims bị bỏ qua (nbf không enforce).
- `test/unit/module/auth/bearer-header.characterization.spec.ts` — 9 case header từ §9 qua `AccessTokenGuard` thật (verify mock): missing, `Basic xxx`, `bearer x`, `BEARER x`, `Bearer`, `Bearer  token`, ` token`, `token `, `Bearer a b`.
- e2e đã cover: lock 403, revoke 401, role refresh, header trailing-data — chạy làm baseline.
**Acceptance:** tất cả test mới + existing pass; không diff production code.
**Risk:** phát hiện behavior chưa được test nào không khớp mô tả → ghi lại vào plan, không sửa.
**Rollback:** xoá file test.

### Phase 1 — Extract validation boundaries
**Goal:** Tách claims validation + principal resolution ra khỏi guard, chưa thêm Passport.
**Files:**
- Create `src/module/auth/access-token-claims.validator.ts` — `@Injectable`, hàm `validate(payload: Record<string, unknown>): AccessTokenPayload` (hoặc `validateUnknown(unknown)`), sync, throw `UnauthorizedException('Invalid access token.')` đúng message hiện tại; di chuyển logic `toAccessTokenPayload` + clock-skew/exp-iat checks từ `AccessTokenService.verify()`.
- Create `src/module/auth/access-token-principal.service.ts` — `resolve(payload): Promise<AuthenticatedPrincipal>`; inject 2 reader; logic nhánh customer/user chuyển từ guard; user role refresh; LOCKED → `ForbiddenException('Tai khoan bi khoa.')`; not-found/version-mismatch → `UnauthorizedException('Invalid access token.')`; DB error không catch.
- Create `src/module/auth/authenticated-principal.ts` — discriminated union (xem §8 dưới).
- Modify `src/module/auth/access-token.service.ts` — `verify()` giữ facade, delegating claims checks sang validator (giữ error timing: signature → header → claims → clock/exp để message contract giữ nguyên).
- Modify `src/module/auth/access-token.guard.ts` — slim xuống: strict header parse → `verify()` → `principalService.resolve()` → gắn `request.auth` (dùng adapter nhất quán với Phase 3).
- Create `test/unit/module/auth/access-token-claims.validator.spec.ts`, `access-token-principal.service.spec.ts`.
**Acceptance:** validator không import DB/HTTP/ORM (grep-verified); principal service không import crypto/JWT/Request; guard không còn DB logic; toàn bộ unit + e2e auth pass.
**Risk:** nhầm thứ tự check làm đổi message trên vài edge case → Phase 0 tests chặn được.
**Rollback:** revert 5 file (guard/service quay về bản git).

### Phase 2 — Replace custom crypto với JwtService
**Goal:** `AccessTokenService` facade giữ nguyên API, crypto bên trong đổi thành `JwtService`.
**Files:**
- `package.json` + `npm install @nestjs/jwt@^11.0.2` (peer `@nestjs/common ^8||^9||^10||^11` OK với NestJS 11; kèm jsonwebtoken 9.0.3). Chạy `npm ls` sau cài.
- Modify `access-token.service.ts`: inject `JwtService`; `sign()` → `jwtService.sign(payload, {secret, algorithm:'HS256', header:{typ:'JWT'}, expiresIn: seconds})` — **truyền số giây đã qua `parseDurationToSeconds`, không truyền string**; `verify()` → `jwtService.verify(token, {secret, algorithms:['HS256'], ignoreExpiration:true, ignoreNotBefore:true, complete:true})` + tự kiểm exp (message `Access token has expired.` giữ riêng) + header alg/typ check trên `decoded.header` + delegating claims validator; catch `TokenExpiredError`/`JsonWebTokenError`/`NotBeforeError` → map về `UnauthorizedException` đúng message hiện tại.
- Modify `auth.module.ts`: `JwtModule.registerAsync({inject:[ConfigService], ...})` hoặc register token trong provider factory — sign/verify đều truyền secret explicit từ ConfigService trong `AccessTokenService` (single source).
**Interop tests** (`access-token.service.spec.ts` mở rộng):
- old-style token (forge bằng helper custom HMAC trong test) → `verify()` mới PASS;
- token mới ký bằng JwtService → verify bằng helper HMAC tự viết PASS;
- old token có claim lạ (`nbf`) → vẫn verify (ignoreNotBefore);
- duration: `1, 1s, 30s, 15m, 1h, 7d` → số giây đúng truyền vào sign (đã có spec, giữ).
**Acceptance:** không còn `createHmac/timingSafeEqual` trong `src/module/auth/access-token.service.ts`; login response shape unchanged; e2e auth workflow pass (old-token interop đảm bảo token đang lưu ở FE session không bị vô hiệu hoá giữa deploy).
**Risk:** khác biệt base64url của jsonwebtoken với buffer tự viết (không đáng kể — spec chuẩn); `JwtService.sign` default header có thể thêm `typ:'JWT'` sẵn — verify giữ `{typ:'JWT'}` explicit; secret reference không được rò vào log.
**Rollback:** revert service + module + package.json/lock.

### Phase 3 — Passport canary trên GET /auth/me
**Goal:** Proof-of-architecture: đúng 1 route chạy Passport, còn lại vẫn dùng guard cũ.
**Files:**
- Install: `npm install @nestjs/passport@^11.0.5 passport@0.7.0 passport-jwt@^4.0.1` + `npm install -D @types/passport-jwt@^4.0.1` (passport-jwt 4 peer jsonwebtoken ^9 + passport-strategy ^1; @nestjs/passport@11 peer passport ^0.5||^0.6||^0.7, @nestjs/common ^10||^11).
- Create `src/module/auth/strategies/strict-bearer.extractor.ts` — `ExtractJwt.fromAuthHeaderWithScheme('Bearer')` KHÔNG đủ strict (nó chấp nhận scheme case-insensitive + token chứa space nếu chỉ 1 segment? thực tế nó split(/\s+/) nên `'Bearer a b'` → token `'a'`) → **tự viết** `ExtractorFn` đọc `req.headers.authorization`, exec đúng regex `^Bearer ([^\s]+)$`, không match → `null`.
- Create `src/module/auth/strategies/jwt.strategy.ts` — `PassportStrategy(Strategy)`; `super({jwtFromRequest: strictExtractor, secretOrKey, algorithms:['HS256'], ignoreExpiration:false, passReqToCallback:false, jsonWebTokenOptions:{complete:true, ignoreNotBefore:true}})`; secret lấy qua ConfigService; `validate(payload: CompleteJwt)`:
  1. check `payload.header.alg === 'HS256' && payload.header.typ === 'JWT'` (passport-jwt KHÔNG check typ);
  2. `claimsValidator.validate(payload.payload)`;
  3. `await principalService.resolve(claims)`;
  4. return principal.
  - Lỗi từ 2-3 ném `UnauthorizedException/ForbiddenException` nguyên vẹn — @nestjs/passport wrap lỗi callback thành error object của Passport-local flow; **phải characterization-test** rằng Nest giữ được status/message (canary e2e: locked → 403, revoke → 401). Nếu @nestjs/passport nuốt message (nó wrap trong `handleRequest` → trả `UnauthorizedException` gốc khi error là HttpException — verify bằng test, không assume).
  - DB error: phải bubble — nếu Passport wrap thành 401 thì throw một error class riêng và convert trong `JwtAuthGuard.canActivate` sau `super.canActivate()`.
- Create `src/module/auth/access-token-adapter.ts` (hoặc đặt trong guard) — `principalToAuth(principal): AccessTokenPayload` deterministic (pure): customer → `{sub, actor_type, customer_id, token_version, iat, exp}`; user → thêm `role: principal.role` (DB role — khớp `request.auth.role` cũ vì guard cũ cũng refresh).
- Create `src/module/auth/guards/jwt-auth.guard.ts` — `extends AuthGuard('jwt')`; `canActivate`: `const result = await super.canActivate(context)`; sau đó gắn `request.auth = principalToAuth(request.user)`; return result. (Gắn trong guard thay vì strategy để `request.auth` luôn derive từ `request.user` ngay cả khi Nest re-hydrate.)
- Modify `auth.module.ts`: `PassportModule`, providers `JwtStrategy`, `JwtAuthGuard`; export `JwtAuthGuard`.
- Modify `auth.controller.ts` GET me: `AccessTokenGuard` → `JwtAuthGuard` (canary duy nhất).
- Tests: `test/unit/module/auth/jwt.strategy.spec.ts` (complete-JWT shape thật — verify qua một token ký thật: `{header:{alg,typ}, payload, signature}`), `jwt-auth.guard.spec.ts` (request.user → request.auth mapping, INCLUDING không mutate lẻ), canary e2e: auth-workflow.e2e-spec chạy nguyên bộ (me đã chuyển sang canary nên toàn bộ e2e auth là regression của canary).
**Acceptance:** `/auth/me` behavior byte-identical (status, message, envelope); FE unchanged; không redundant DB lookup (passport verify → 1 lần `principalService.resolve` = 1 reader call như guard cũ; `getMe()` vẫn query riêng như cũ — không thêm cái mới); các route khác vẫn dùng AccessTokenGuard.
**Risk:** (a) Passport error mapping khác guard cũ → dùng characterization test chặn; (b) `request.user` bị Passport deserialize/mock sai trong unit test → test bằng strategy thật với token thật.
**Rollback:** đổi lại 1 dòng ở auth.controller + bỏ provider mới.

### Phase 4 — Migrate protected controllers
**Goal:** Tất cả 13 controller còn lại `AccessTokenGuard` → `JwtAuthGuard`.
**Files:** các file đã liệt kê trong §1 bảng (booking, customer ×3, user-admin, room ×3, room-type, amenity, payment ×2) — chỉ đổi import + `@UseGuards(JwtAuthGuard, ...)`.
**Lưu ý wiring:** feature modules đã import `AuthModule` (export `JwtAuthGuard` từ Phase 3) → không cần thêm module import. Chạy module-by-module (booking → customer → user → room → room-type → amenity → payment), test e2e domain tương ứng sau mỗi cụm.
**Tests:** full `npm run test` + `npm run test:e2e` (toàn bộ workflow specs).
**Acceptance:** `grep -r "AccessTokenGuard" src/` chỉ còn auth.module (hoặc 0); authorization regression pass; ActorsGuard/RolesGuard/CurrentAuth untouched.
**Risk:** thấp — cùng pipeline; rủi ro chính là quên 1 controller → grep check.
**Rollback:** git revert từng module.

### Phase 5 — Cleanup
**Goal:** Bỏ custom implementation còn sót.
**Files:**
- Xoá `access-token.guard.ts` + spec cũ của nó (nếu mọi route đã chuyển và không test nào tham chiếu);
- Trong `access-token.service.ts`: bỏ phần verify custom còn sót nếu có (sau Phase 2 không còn HMAC — double-check);
- `auth.module.ts`: bỏ export `AccessTokenGuard`;
- Giữ `AccessTokenService` (facade cho sign/verify/getExpiresInSeconds — WS-ready), giữ readers, giữ adapter, giữ ClaimsValidator/PrincipalService.
- README/docs: cập nhật auth section (Phase 6 gộp chung bước này nếu muốn 1 PR).
**Tests:** full unit + e2e + `npm run lint` + `npm run build` + `npm run openapi:validate` (openapi.json không đổi — verify).
**Acceptance:** Definition of Done §24; không duplicate JWT implementation; `npm ls passport` sạch.
**Rollback:** revert commit cleanup.

### Phase 6 — Documentation
**Files:** README.md (auth section), optional `docs/`:
- `request.user` = canonical `AuthenticatedPrincipal`; `request.auth` = compatibility view (derive-only, không mutate);
- ClaimsValidator / PrincipalService boundary; token_version & revocation; LOCKED → 403; DB role authority;
- JWT config (secret ≥32, duration grammar, HS256);
- WebSocket-ready recipe (đoạn code ngắn: `socket.handshake.auth.token → accessTokenService.verify() → claimsValidator → principalService.resolve() → socket.data.auth`) — **chỉ document, không implement**.

## 7. File-level change map (chỉ path đã tồn tại hoặc cần tạo mới thực sự)

**Create:**
- `src/module/auth/access-token-claims.validator.ts`
- `src/module/auth/access-token-principal.service.ts`
- `src/module/auth/authenticated-principal.ts`
- `src/module/auth/access-token-adapter.ts` (principal→legacy auth view)
- `src/module/auth/strategies/strict-bearer.extractor.ts`
- `src/module/auth/strategies/jwt.strategy.ts`
- `src/module/auth/guards/jwt-auth.guard.ts`
- `test/unit/module/auth/access-token.characterization.spec.ts`
- `test/unit/module/auth/bearer-header.characterization.spec.ts`
- `test/unit/module/auth/access-token-claims.validator.spec.ts`
- `test/unit/module/auth/access-token-principal.service.spec.ts`
- `test/unit/module/auth/jwt.strategy.spec.ts`
- `test/unit/module/auth/jwt-auth.guard.spec.ts`

**Modify:** `src/module/auth/access-token.service.ts`, `src/module/auth/access-token.guard.ts` (Phase 1 slim, Phase 5 xoá), `src/module/auth/auth.module.ts`, `src/module/auth/auth.controller.ts`, 13 controller (Phase 4), `package.json`/`package-lock.json`, `README.md`.

**Không đổi:** `ActorsGuard`, `RolesGuard`, `CurrentAuth`, `ReqContext`, `request.types.ts` (có thể thêm optional `user?:` nếu TS cần — cân nhắc giữ `auth` làm field duy nhất thêm `user` optional), DTO, OpenAPI, `AuthService.getMe`, FE production code.

## 8. JWT compatibility analysis

| Khía cạnh | Custom hiện tại | JwtService (jsonwebtoken 9) | Ghi chú |
|---|---|---|---|
| Signature | HMAC-SHA256, base64url tự viết | HS256 giống hệt (RFC 7515) | byte-identical signature |
| Header | `{alg, typ}` | sign cho phép `header:{typ:'JWT'}` | giữ explicit |
| exp/iat | tự tính | `expiresIn` nhận **số giây** (an toàn) | truyền số, không string |
| exp check | `exp <= now` → message riêng | library check `exp < now` + error riêng `TokenExpiredError` | **chênh 1 giây biên** (`exp==now`): library coi còn hạn (now===exp → không reject vì condition là `exp < now`... thực tế jsonwebtoken: `if (exp <= clockTimestamp)` reject — cần test biên) → quyết định: giữ `ignoreExpiration:false` để library check, test biên `exp===now` và align theo library nếu khác 1 giây với hiện trạng (hiện `exp<=now` reject). An toàn nhất: `ignoreExpiration:true` + tự check `exp <= now → 'Access token has expired.'` — **khuyến nghị phương án này** để message + biên giữ nguyên 100%. |
| iat future +60 | tự check | library KHÔNG check iat | ClaimsValidator giữ |
| exp > iat | tự check | library không check | ClaimsValidator giữ |
| nbf | bỏ qua (không enforce) | mặc định enforce nếu có nbf | `ignoreNotBefore:true` preserve |
| typ check | có | passport-jwt/JwtService KHÔNG check typ | strategy tự check header |
| alg check | có (header.alg) | JwtService.verify pin `algorithms:['HS256']` (không tấn công alg-confusion vì secret symmetric) | strategy vẫn check header cho defense-in-depth |
| extra claims | bị drop khỏi kết quả | giữ trong decoded payload | ClaimsValidator chỉ emit payload shape chuẩn → drop tương đương |
| format lỗi | 3-segment check thủ công | `JsonWebTokenError 'jwt malformed'` | map message về `Invalid access token.` |

**Kết luận:** semantic-compatible. Không rotate secret. Token cũ verify được bởi pipeline mới (interop test bắt buộc).

## 9. Passport-specific concerns

- **Strict extractor:** tự viết (default `fromAuthHeaderWithScheme` dùng `split(/\s+/)` → lỏng hơn regex hiện tại). Characterization 9 case ở Phase 0 → reuse cho extractor spec Phase 3.
- **`jsonWebTokenOptions`:** `{complete:true, ignoreNotBefore:true}` (đúng option nest của passport-jwt 4.x — verify trong node_modules sau cài: `node_modules/passport-jwt/lib/strategy.js` đọc `this._jwtOptions`/`jsonWebTokenOptions` pass thẳng vào `jwt.verify`).
- **`complete:true` shape:** `validate()` nhận `{header:{alg,typ}, payload:object, signature:string}` — tạo `interface CompleteJwt`; **không assume** payload thẳng.
- **Error mapping matrix (characterization bắt buộc ở Phase 3):**
  | Case | Current | Passport target |
  |---|---|---|
  | missing/malformed header | 401 `Authorization bearer token is required.` | extractor → null → passport `UnauthorizedException('Unauthorized')`? → **JwtAuthGuard phải map về message cũ** |
  | bad signature/malformed token/wrong claims | 401 `Invalid access token.` | claims validator throw nguyên bản (Nest HttpException pass qua @nestjs/passport `handleRequest`) — verify bằng test |
  | expired | 401 `Access token has expired.` | nếu library verify exp → `TokenExpiredError` → phải map; **khuyến nghị `ignoreExpiration:true` + ClaimsValidator tự check** để error path cũ tự nhiên đi qua |
  | locked | 403 `Tai khoan bi khoa.` | `ForbiddenException` từ PrincipalService — verify không bị wrap thành 401 |
  | DB error | 500 bubble | phải bubble — nếu bị wrap, rethrow trong guard |
- **`request.user`:** được gắn bởi @nestjs/passport; typing qua `declare module 'express-serve-static-core' { interface Request { user?: AuthenticatedPrincipal } }` hoặc augment kiểu cục bộ.
- **Không global guard** — `APP_GUARD` không được thêm.

## 10. Testing strategy

- **Unit (mới):** characterization (Phase 0), claims validator, principal service (mock readers; case: active customer/user, not-found, version mismatch, LOCKED, role refresh, DB throw bubble), token service interop + duration, strategy/extractor/guard.
- **Integration/e2e (reuse, không duplicate):** `auth-workflow.e2e-spec.ts`, `app.e2e-spec.ts`, các domain workflow (booking/payment/customer/user/room/room-type/amenity) chạy nguyên — chúng là regression suite thực sự vì hầu hết đi qua guard.
- **Frontend regression (không sửa code):** trong `homestay-booking-management-system-fe`: `npm run typecheck`, `lint`, `test` (vitest), contract check (`src/api/generated` không regenerate trừ khi cần). Verify bằng tay: login → session persist (`hbms.auth.session.v1`) → `/auth/me` → 401 handling → logout. FE chỉ gửi `Authorization: Bearer <token>` (client.ts L168) và **không decode JWT** (đã grep xác nhận) → không bị ảnh hưởng.
- **Verify command mỗi phase:** `npm run test` (+ `npm run test:e2e` khi đụng wiring), `npm run lint`, `npm run build`.

## 11. Security review

- Không đổi secret/algorithm/expiry; không thêm refresh/cookie/iss/aud; không enforce nbf mới.
- Không log token/secret (request-context chỉ log `auth` object gọn — giữ nguyên hành vi; kiểm tra `ReqContext` consumers không log payload nguyên).
- Timing-safe compare: jsonwebtoken dùng `crypto.timingSafeEqual` nội bộ — OK.
- alg-confusion: pin `algorithms:['HS256']` mọi nơi verify.
- Authorization vẫn tách ở ActorsGuard/RolesGuard; DB role là authority; JWT role chỉ snapshot compatibility (validator vẫn từ chối role ngoài enum).
- Principal không chứa ORM entity (chỉ scalar).

## 12. Rollout & rollback

- Rollout theo phase trong cùng branch; mỗi phase có acceptance riêng; deploy có thể dừng an toàn sau Phase 2 (crypto mới, guard cũ) hoặc Phase 3 (canary).
- Rollback mỗi phase = revert files của phase đó; interop tests đảm bảo token sống sót qua lại giữa versions.
- Production caution: sau Phase 2, token do bản mới ký vẫn HS256/typ-JWT/cùng secret → tương thích ngược với token cũ đang lưu ở FE session (session chỉ cache profile + token, token không bị re-verify ở FE).

## 13. WebSocket readiness

Pipeline verify/resolve tách khỏi HTTP từ Phase 1-2: `AccessTokenService.verify()` (facade) + `AccessTokenClaimsValidator` + `AccessTokenPrincipalService.resolve()` callable trực tiếp từ gateway. Không dùng JwtStrategy/JwtAuthGuard/request.user cho Socket.IO. Chỉ cần document (Phase 6), không code.

## 14. Final recommendation

- **Recommended architecture:** đúng như §4 — giữ `AccessTokenService` facade, thêm ClaimsValidator (pure) + PrincipalService (DB) + JwtStrategy/JwtAuthGuard (HTTP adapter) + strict extractor + compat adapter `request.user → request.auth`.
- **Migration order:** Phase 0 → 1 → 2 → 3 (canary /auth/me) → 4 (13 controllers) → 5 (cleanup) → 6 (docs). Không nhảy Passport trước khi boundaries sạch.
- **Complexity:** trung bình. Điểm khó nhất là error-message parity (Passport error mapping) — được khoá bằng characterization tests. Thứ hai là `complete:true` shape.
- **Main regression risks:**
  1. Passport nuốt/đổi message lỗi (401 vs 403 vs message text) → e2e auth-workflow chặn;
  2. Boundary exp===now khác 1 giây → test biên, chọn `ignoreExpiration:true` + tự check;
  3. Extractor lỏng hơn regex cũ → tự viết extractor, không dùng default;
  4. Quên controller chưa migrate → grep AccessTokenGuard sau Phase 4;
  5. Duplicate DB lookup mới trên /auth/me nếu strategy resolve rồi getMe query lại — **đúng như hiện trạng** (guard cũ cũng vậy), không thêm bớt.
- **Explicitly out-of-scope:** nbf enforcement, Bearer grammar nới, /auth/me lookup optimization, refresh token/cookie/iss/aud, WebSocket implementation, FE production changes, global auth guard, NestJS core upgrades, role-error granularity trong response.

---

### Phụ lục — Discrepancies giữa prompt và working tree (codebase thắng)
1. Auth ở `src/module/auth/**` (prompt warning chính xác); `src/common/http` chỉ có request types + ReqContext.
2. `getMe()` KHÔNG dùng `request.auth.role` cho response — nó query lại entity (role trong response đến từ DB query của getMe, không phải principal) → việc giữ principal không-entity không ảnh hưởng response.
3. `AccessTokenPayload.token_version` hiện optional trong type nhưng verify() luôn require → principal type mới sẽ làm nó required (siết type, không đổi behavior).
4. RateLimitGuard là global-ish qua `@UseGuards` controller-level — không liên quan migration.
5. Registry check thực tế: `@nestjs/jwt` latest 12.0.1 (peer chỉ tới ^11? — peer của 11.0.2 là ^8||^9||^10||^11), chọn **@nestjs/jwt@^11.0.2**, **@nestjs/passport@^11.0.5**, `passport@0.7.0`, `passport-jwt@^4.0.1`, `@types/passport-jwt@^4.0.1` — tất cả NestJS-11 line, không upgrade core.
