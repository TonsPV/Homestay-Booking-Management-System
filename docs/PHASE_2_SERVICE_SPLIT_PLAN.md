# Phase 2: Service Split Implementation Plan

Status as of 2026-07-29: IMPLEMENTED AND VERIFIED.

The split was executed only after Booking/Payment characterization. Current
verified unit coverage is 64.98% lines, above the 45% project gate. Booking
Lifecycle reaches 76.08% branch coverage. Payment critical state transitions all
have direct unit or MySQL E2E evidence; aggregate targeted Payment branch
coverage is 60.92%, so the strict 70% target remains a hardening target rather
than being reported as achieved.

Final service layout:

- Booking facade 101 lines; Query 262; Creation 497; Lifecycle 404.
- Payment facade 139 lines; Query 241; Manual 244; Collection 587; Refund 751;
  shared booking policy 81.
- Room follow-up facade 65 lines; Query 442; Mutation 358.

Detailed evidence is in audit reports 07B-08C and 13.

## Overview

Split large monolithic services into focused capability-based services while maintaining:
- No route changes
- No response changes
- No enum/status changes
- Transaction boundaries preserved
- All existing tests pass

## PaymentService Split (1,716 lines)

### Current Public Methods
1. `listForCustomer` → PaymentQueryService
2. `listManagement` → PaymentQueryService
3. `listAllManagement` → PaymentQueryService
4. `recordManualPayment` → ManualPaymentService
5. `createVnPayPayment` → VnPayCollectionService
6. `handleVnPayIpn` → VnPayCollectionService
7. `handleVnPayReturn` → VnPayCollectionService
8. `expirePendingOnlinePayments` → PaymentExpirationService
9. `refund` → PaymentRefundService
10. `reconcileVnPayRefund` → PaymentRefundService

### Target Services

#### 1. PaymentQueryService (~200 lines)
**Responsibility**: Read-only payment queries
- `listForCustomer(customerId, query)`
- `listManagement(bookingId, query)`
- `listAllManagement(query)`
- Shared: `createPaymentQuery()`, `toResponse()`

#### 2. ManualPaymentService (~300 lines)
**Responsibility**: Manual payment recording (cash/bank transfer)
- `recordManualPayment(userId, dto)`
- Shared: `assertBookingCanBePaid()`, `assertIdempotentReplay()`

#### 3. VnPayCollectionService (~600 lines)
**Responsibility**: VNPay payment creation and callbacks
- `createVnPayPayment(customerId, dto)`
- `handleVnPayIpn(query)`
- `handleVnPayReturn(query)`
- Shared: `validateVnPayCallback()`, VNPay callback processing

#### 4. PaymentRefundService (~400 lines)
**Responsibility**: Refund operations
- `refund(userId, paymentId, dto)`
- `reconcileVnPayRefund(userId, paymentId)`
- Shared: `assertVnPayRefundAllowed()`, refund state machine

#### 5. PaymentExpirationService (~100 lines)
**Responsibility**: Cron job coordination only
- `expirePendingOnlinePayments(now)`
- Delegates to VnPayCollectionService for actual logic

### Shared Helpers
- `payment-query.helper.ts` - Query builder
- `payment-response.mapper.ts` - toResponse()
- `payment-validation.helper.ts` - Common validations

## BookingService Split (1,083 lines)

### Target Services

#### 1. BookingQueryService (~250 lines)
- `findById()`, `listForCustomer()`, `listManagement()`

#### 2. BookingCreationService (~400 lines)
- `createOnline()`, `createCounter()`

#### 3. BookingLifecycleService (~300 lines)
- `confirm()`, `checkIn()`, `checkOut()`, `cancel()`

#### 4. BookingExpirationService (~100 lines)
- Cron job coordination only

## Implementation Strategy

### Phase 2.1: PaymentQueryService (Week 1)
1. Create PaymentQueryService with query methods
2. Update PaymentController to inject new service
3. Keep PaymentService as facade for backward compatibility
4. Add unit tests for PaymentQueryService
5. Verify all tests pass

### Phase 2.2: ManualPaymentService (Week 1)
1. Extract manual payment logic
2. Update PaymentController
3. Add unit tests

### Phase 2.3: VnPayCollectionService (Week 2)
1. Extract VNPay collection logic
2. Update VnPayController
3. Add unit tests

### Phase 2.4: PaymentRefundService (Week 2)
1. Extract refund logic
2. Update PaymentController
3. Add unit tests

### Phase 2.5: BookingService Split (Week 3)
1. Extract BookingQueryService
2. Extract BookingCreationService
3. Extract BookingLifecycleService
4. Add unit tests

## Testing Strategy

### Unit Tests
- Mock repositories and external services
- Test business rules in isolation
- Target: 70% branch coverage for state machines

### Integration Tests
- Keep existing E2E tests
- Add focused E2E tests for each new service
- Verify transaction boundaries

## Success Criteria

- [x] No service exceeds the 800-line hard ceiling
- [x] Transaction boundaries preserved
- [x] All existing tests pass
- [x] New direct unit tests cover critical state transitions
- [x] Project unit line coverage exceeds 45%
- [ ] Every Payment capability reaches the aspirational 70% branch target
- [x] OpenAPI snapshot regenerated and drift-checked
- [x] No route changes
- [x] No response changes

## Risk Mitigation

1. **Incremental approach**: Split one service at a time
2. **Facade pattern**: Keep PaymentService as facade during transition
3. **Test-first**: Add characterization tests before splitting
4. **Rollback plan**: Each split is a separate commit, easy to revert
