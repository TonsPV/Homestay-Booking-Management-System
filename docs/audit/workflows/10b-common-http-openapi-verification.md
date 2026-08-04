# Lượt 10B - Common HTTP, security và OpenAPI

Date: 2026-08-01  
Scope: Shared success/error envelopes, request IDs, security headers/CORS,
authorization metadata, rate limiting, DTO boundary and OpenAPI contract.

## 1. Workflow evidence

| Workflow/check | Result | Evidence |
|---|---|---|
| Success envelope/status/path/timestamp | VERIFIED | Dedicated E2E `/api/health/live` returns the shared success envelope with status `200`, path and generated timestamp. Existing module E2E checks `201` and `200` route mappings. |
| Error envelope/status/path | VERIFIED | Dedicated E2E unknown route returns `404`, `success=false`, `error=Not Found`, request ID and original path. Auth/validation error matrices are covered by module suites. |
| Request ID valid propagation | VERIFIED | `X-Request-Id: common-http-id` is echoed in the header and envelope. |
| Request ID invalid/generation | VERIFIED | Unsafe value containing spaces is replaced with a UUIDv4; it is never reflected into the response header. Unit middleware tests cover CRLF-like input. |
| Helmet/static media nosniff | VERIFIED / COVERED_BY_EXISTING | Helmet is installed globally; E2E sees `X-Content-Type-Options: nosniff`; Room Image E2E covers static/media nosniff behavior. |
| CORS development behavior | VERIFIED | Dedicated E2E receives the requesting Origin in `access-control-allow-origin` when the test allow-all mode is active. `configure-app.spec.ts` verifies production-style configured allowlist wiring. |
| CORS production allowlist enforcement | PARTIAL | Configuration validation requires a non-empty allowlist in production and unit tests verify wiring; no production deployment was run in this repository. |
| Actors/Roles metadata | VERIFIED / COVERED_BY_EXISTING | Decorator metadata and guard unit suites pass; module E2E matrices cover anonymous/customer/STAFF/ADMIN boundaries and locked/missing account refresh. |
| Rate limiting | VERIFIED | Health E2E reaches the 30-request readiness bucket and observes `429` + `Retry-After`; guard unit tests cover reset. It is an in-memory single-process map, not a distributed limiter. |
| Runtime unknown-field policy | VERIFIED / NEEDS_DECISION | Registration with an extra JSON property succeeds and the property is ignored/not persisted. There is no global `ValidationPipe`/whitelist in the current bootstrap. Whether to reject unknown fields is a contract decision before adding a breaking boundary. |
| Public/customer/management projections | VERIFIED / COVERED_BY_MODULES | Room, Booking and Payment reports assert exact visibility boundaries; customer projections omit management/gateway/audit fields. |
| OpenAPI schemas and snapshot drift | VERIFIED | `npm run openapi:validate` reports the committed snapshot current and the contract suite passes. Existing E2E checks typed request examples and multipart image schema. |
| Every documented response status reachable | PARTIAL | Route/controller tests exercise the primary success and common error statuses. The repository has no complete generated status-to-workflow coverage checker; remaining documented branches stay a final audit item. |
| Runtime payload validation against JSON Schema | PARTIAL | DTO/OpenAPI schemas are generated and contract-checked, but no live JSON-Schema validator runs over representative response bodies. Current evidence is endpoint assertions plus schema snapshot checks. |

## 2. Architecture/design check

- `configureApp` centralizes Helmet, request-ID middleware, static asset
  headers, CORS, the success interceptor, exception filter and shutdown hooks.
- The interceptor/filter preserve one response envelope while keeping
  controller/service code free of transport formatting.
- Guards use metadata decorators (`@Actors`, `@Roles`, `@RateLimit`) and query
  the authorization readers for current account state; role data is refreshed
  from the database rather than trusted solely from an old token.
- The rate limiter is intentionally process-local. It is suitable for one
  process but requires shared storage or an edge limiter for multiple replicas.
- No duplicate HTTP envelope implementation or route rename was introduced in
  this round. Unknown-field handling is an explicit compatibility decision,
  not silently changed during audit.

## 3. Verification commands

| Command | Result |
|---|---|
| `npx jest --config ./test/jest-e2e.json --runInBand test/common-http-workflow.e2e-spec.ts` | PASS, 1 suite / 2 tests |
| `npm run openapi:validate` | PASS; snapshot current, 4 contract tests |
| `npm run test -- --runInBand` | PASS in final integration: 42 suites / 302 tests |
| `npm run test:e2e -- --runInBand` | PASS in final integration: 20 suites / 98 tests |
| `npm run lint` | PASS in final integration |

## 4. Lượt 10B conclusion

Status: **PASS for the implemented common HTTP/security/OpenAPI workflows;
unknown-field policy, distributed rate limiting, production CORS deployment and
full runtime-schema/status reachability remain PARTIAL or NEEDS_DECISION.**

Proceed to Lượt 11 (Database and maintenance verification).
