import { Injectable } from '@nestjs/common';

import { CreateManualPaymentDto } from './dto/create-manual-payment.dto';
import { CreateVnpayPaymentDto } from './dto/create-vnpay-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentCollectionService } from './payment-collection.service';
import { PaymentManualService } from './payment-manual.service';
import {
  type CustomerPaymentListResult,
  type ManagementPaymentListResult,
  PaymentQueryService,
  type PaymentListResult,
} from './payment-query.service';
import { PaymentRefundService } from './payment-refund.service';
import type { PaymentMethod } from './domain/payment-state';
import type {
  OnlinePaymentResponse,
  PaymentResponse,
  VnPayIpnResponse,
  VnPayReturnResponse,
} from './payment.types';

export type {
  OnlinePaymentResponse,
  CustomerPaymentResponse,
  PaymentResponse,
  VnPayIpnResponse,
  VnPayReturnResponse,
} from './payment.types';

@Injectable()
export class PaymentService {
  constructor(
    private readonly collection: PaymentCollectionService,
    private readonly manual: PaymentManualService,
    private readonly query: PaymentQueryService,
    private readonly refundService: PaymentRefundService,
  ) {}

  async listForCustomer(
    customerId: string | undefined,
    bookingId: string,
    query: ListPaymentsQueryDto,
  ): Promise<CustomerPaymentListResult> {
    return this.query.listForCustomer(customerId, bookingId, query);
  }

  async listManagement(
    bookingId: string,
    query: ListPaymentsQueryDto,
  ): Promise<PaymentListResult> {
    return this.query.listManagement(bookingId, query);
  }

  async listAllManagement(
    query: ListPaymentsQueryDto,
    allowedMethods?: readonly PaymentMethod[],
  ): Promise<ManagementPaymentListResult> {
    return this.query.listAllManagement(query, allowedMethods);
  }

  async recordManualPayment(
    userId: string | undefined,
    bookingId: string,
    idempotencyKey: string | undefined,
    body: CreateManualPaymentDto,
    requestId?: string,
  ): Promise<PaymentResponse> {
    return this.manual.record(
      userId,
      bookingId,
      idempotencyKey,
      body,
      requestId,
    );
  }

  async createVnPayPayment(
    customerId: string | undefined,
    bookingId: string,
    idempotencyKey: string | undefined,
    clientIp: string | undefined,
    body: CreateVnpayPaymentDto,
  ): Promise<OnlinePaymentResponse> {
    return this.collection.createVnPayPayment(
      customerId,
      bookingId,
      idempotencyKey,
      clientIp,
      body,
    );
  }

  async handleVnPayIpn(
    query: Record<string, unknown>,
    requestId?: string,
  ): Promise<VnPayIpnResponse> {
    return this.collection.handleVnPayIpn(query, requestId);
  }

  async handleVnPayReturn(
    query: Record<string, unknown>,
    requestId?: string,
  ): Promise<VnPayReturnResponse> {
    return this.collection.handleVnPayReturn(query, requestId);
  }

  async expirePendingOnlinePayments(now = new Date()): Promise<number> {
    return this.collection.expirePendingOnlinePayments(now);
  }

  countStaleRefunds(now = new Date()): Promise<number> {
    return this.query.countStaleRefunds(now);
  }

  async refund(
    userId: string | undefined,
    paymentId: string,
    idempotencyKey: string | undefined,
    clientIp: string | undefined,
    body: RefundPaymentDto,
    requestId?: string,
  ): Promise<PaymentResponse> {
    return this.refundService.refund(
      userId,
      paymentId,
      idempotencyKey,
      clientIp,
      body,
      requestId,
    );
  }

  async reconcileVnPayRefund(
    userId: string | undefined,
    paymentId: string,
    clientIp: string | undefined,
    requestId?: string,
  ): Promise<PaymentResponse> {
    return this.refundService.reconcileVnPayRefund(
      userId,
      paymentId,
      clientIp,
      requestId,
    );
  }

  async resolveDuplicateCharge(
    userId: string | undefined,
    paymentId: string,
    idempotencyKey: string | undefined,
    clientIp: string | undefined,
    requestId?: string,
  ): Promise<PaymentResponse> {
    return this.refundService.resolveDuplicateCharge(
      userId,
      paymentId,
      idempotencyKey,
      clientIp,
      requestId,
    );
  }
}
