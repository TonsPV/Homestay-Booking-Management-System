import { Injectable } from '@nestjs/common';

import { CreateManualPaymentDto } from './dto/create-manual-payment.dto';
import { CreateVnpayPaymentDto } from './dto/create-vnpay-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentCollectionService } from './payment-collection.service';
import { PaymentManualService } from './payment-manual.service';
import {
  type CustomerPaymentListResult,
  PaymentQueryService,
  type PaymentListResult,
} from './payment-query.service';
import { PaymentRefundService } from './payment-refund.service';
import type { PaymentMethod } from './schema/payment.entity';
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
    private readonly paymentCollectionService: PaymentCollectionService,
    private readonly paymentManualService: PaymentManualService,
    private readonly paymentQueryService: PaymentQueryService,
    private readonly paymentRefundService: PaymentRefundService,
  ) {}

  async listForCustomer(
    customerId: string | undefined,
    bookingId: string,
    query: ListPaymentsQueryDto,
  ): Promise<CustomerPaymentListResult> {
    return this.paymentQueryService.listForCustomer(
      customerId,
      bookingId,
      query,
    );
  }

  async listManagement(
    bookingId: string,
    query: ListPaymentsQueryDto,
  ): Promise<PaymentListResult> {
    return this.paymentQueryService.listManagement(bookingId, query);
  }

  async listAllManagement(
    query: ListPaymentsQueryDto,
    allowedMethods?: readonly PaymentMethod[],
  ): Promise<PaymentListResult> {
    return this.paymentQueryService.listAllManagement(query, allowedMethods);
  }

  async recordManualPayment(
    userId: string | undefined,
    bookingId: string,
    idempotencyKey: string | undefined,
    body: CreateManualPaymentDto,
  ): Promise<PaymentResponse> {
    return this.paymentManualService.record(
      userId,
      bookingId,
      idempotencyKey,
      body,
    );
  }

  async createVnPayPayment(
    customerId: string | undefined,
    bookingId: string,
    idempotencyKey: string | undefined,
    clientIp: string | undefined,
    body: CreateVnpayPaymentDto,
  ): Promise<OnlinePaymentResponse> {
    return this.paymentCollectionService.createVnPayPayment(
      customerId,
      bookingId,
      idempotencyKey,
      clientIp,
      body,
    );
  }

  async handleVnPayIpn(
    query: Record<string, unknown>,
  ): Promise<VnPayIpnResponse> {
    return this.paymentCollectionService.handleVnPayIpn(query);
  }

  async handleVnPayReturn(
    query: Record<string, unknown>,
  ): Promise<VnPayReturnResponse> {
    return this.paymentCollectionService.handleVnPayReturn(query);
  }

  async expirePendingOnlinePayments(now = new Date()): Promise<number> {
    return this.paymentCollectionService.expirePendingOnlinePayments(now);
  }

  countStaleRefunds(now = new Date()): Promise<number> {
    return this.paymentQueryService.countStaleRefunds(now);
  }

  async refund(
    userId: string | undefined,
    paymentId: string,
    idempotencyKey: string | undefined,
    clientIp: string | undefined,
    body: RefundPaymentDto,
  ): Promise<PaymentResponse> {
    return this.paymentRefundService.refund(
      userId,
      paymentId,
      idempotencyKey,
      clientIp,
      body,
    );
  }

  async reconcileVnPayRefund(
    userId: string | undefined,
    paymentId: string,
    clientIp: string | undefined,
  ): Promise<PaymentResponse> {
    return this.paymentRefundService.reconcileVnPayRefund(
      userId,
      paymentId,
      clientIp,
    );
  }
}
