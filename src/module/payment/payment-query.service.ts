import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository, type SelectQueryBuilder } from 'typeorm';

import {
  createPaginationMeta,
  type PaginationMeta,
} from '../../common/pagination/pagination.types';
import { parsePagination } from '../../common/validation';
import { Booking } from '../booking/schema/booking.entity';
import type { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import type { CustomerPaymentResponse, PaymentResponse } from './payment.types';
import { Payment } from './schema/payment.entity';
import { PaymentMethod, PaymentStatus } from './domain/payment-state';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const STALE_REFUND_DAYS = 7;

export interface PaymentListResult {
  items: PaymentResponse[];
  meta: PaginationMeta;
}

export interface CustomerPaymentListResult {
  items: CustomerPaymentResponse[];
  meta: PaginationMeta;
}

export interface ManagementPaymentListResult {
  items: PaymentResponse[];
  meta: PaginationMeta & {
    staleRefundCount: number;
  };
}

@Injectable()
export class PaymentQueryService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
  ) {}

  async listForCustomer(
    customerId: string | undefined,
    bookingId: string,
    query: ListPaymentsQueryDto,
  ): Promise<CustomerPaymentListResult> {
    const activeCustomerId = this.requireActorId(customerId);
    this.validateId(bookingId, 'Booking id khong hop le.');
    const booking = await this.bookingRepo.findOneBy({ id: bookingId });

    if (booking === null || booking.customerId !== activeCustomerId) {
      throw new NotFoundException('Khong tim thay booking.');
    }

    return this.listCustomer(bookingId, query);
  }

  async listManagement(
    bookingId: string,
    query: ListPaymentsQueryDto,
  ): Promise<PaymentListResult> {
    this.validateId(bookingId, 'Booking id khong hop le.');

    if (
      (await this.bookingRepo.exists({
        where: { id: bookingId },
      })) === false
    ) {
      throw new NotFoundException('Khong tim thay booking.');
    }

    return this.listByBooking(bookingId, query);
  }

  async listAllManagement(
    query: ListPaymentsQueryDto,
    allowedMethods?: readonly PaymentMethod[],
  ): Promise<ManagementPaymentListResult> {
    const [paymentList, staleRefundCount] = await Promise.all([
      this.listPayments(query, undefined, allowedMethods),
      allowedMethods === undefined ? this.countStaleRefunds() : 0,
    ]);

    return {
      ...paymentList,
      meta: {
        ...paymentList.meta,
        staleRefundCount,
      },
    };
  }

  async getManagementPayment(id: string): Promise<PaymentResponse> {
    return this.toManagementResponse(await this.requirePayment(id));
  }

  countStaleRefunds(now = new Date()): Promise<number> {
    const staleRefundCutoff = new Date(
      now.getTime() - STALE_REFUND_DAYS * MILLISECONDS_PER_DAY,
    );

    return this.paymentRepo
      .createQueryBuilder('payment')
      .innerJoin('payment.refund', 'refund')
      .where('payment.status = :status', {
        status: PaymentStatus.REFUND_PENDING,
      })
      .andWhere('refund.requestedAt < :cutoff', { cutoff: staleRefundCutoff })
      .getCount();
  }

  private async requirePayment(id: string): Promise<Payment> {
    const payment = await this.createQuery()
      .where('payment.id = :id', { id })
      .getOne();

    if (payment === null) {
      throw new NotFoundException('Khong tim thay payment.');
    }

    return payment;
  }

  toManagementResponse(payment: Payment): PaymentResponse {
    const refund = payment.refund ?? null;

    return {
      id: payment.id,
      bookingId: payment.bookingId,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      status: payment.status,
      reviewReason: payment.reviewReason,
      reviewCanonicalPaymentId: payment.reviewCanonicalPaymentId,
      gatewayName: payment.gatewayName,
      gatewayReference: payment.gatewayReference,
      gatewayTransactionId: payment.gatewayTransactionId,
      gatewayResponseCode: payment.gatewayResponseCode,
      gatewayTransactionStatus: payment.gatewayTransactionStatus,
      gatewayTransactionDate: payment.gatewayTransactionDate,
      refundRequestId: refund?.requestId ?? null,
      refundPreviousStatus: refund?.previousPaymentStatus ?? null,
      refundGatewayTransactionId: refund?.gatewayTransactionId ?? null,
      refundResponseCode: refund?.responseCode ?? null,
      refundTransactionStatus: refund?.transactionStatus ?? null,
      refundMessage: refund?.message ?? null,
      refundReason: refund?.reason ?? null,
      createdByUserId: payment.createdByUserId,
      refundedByUserId: refund?.refundedByUserId ?? null,
      paidAt: payment.paidAt,
      refundedAt: refund?.refundedAt ?? null,
      refundRequestedAt: refund?.requestedAt ?? null,
      refundLastQueriedAt: refund?.lastQueriedAt ?? null,
      expiresAt: payment.expiresAt,
      createdByUser:
        payment.createdByUser === null
          ? null
          : {
              id: payment.createdByUser.id,
              fullName: payment.createdByUser.fullName,
            },
      refundedByUser:
        refund?.refundedByUser === null || refund?.refundedByUser === undefined
          ? null
          : {
              id: refund.refundedByUser.id,
              fullName: refund.refundedByUser.fullName,
            },
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }

  toCustomerResponse(payment: Payment): CustomerPaymentResponse {
    return {
      id: payment.id,
      bookingId: payment.bookingId,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      status: payment.status,
      gatewayReference: payment.gatewayReference,
      paidAt: payment.paidAt,
      refundedAt: payment.refund?.refundedAt ?? null,
      expiresAt: payment.expiresAt,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }

  private async listByBooking(
    bookingId: string,
    query: ListPaymentsQueryDto,
  ): Promise<PaymentListResult> {
    return this.listPayments(query, bookingId);
  }

  private async listCustomer(
    bookingId: string,
    query: ListPaymentsQueryDto,
  ): Promise<CustomerPaymentListResult> {
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const status = this.optionalStatus(query.status);
    const method = this.optionalMethod(query.method);
    const paymentsQuery = this.paymentRepo
      .createQueryBuilder('payment')
      .leftJoinAndSelect('payment.refund', 'refund')
      .andWhere('payment.bookingId = :bookingId', { bookingId })
      .orderBy('payment.createdAt', 'DESC')
      .addOrderBy('payment.id', 'DESC')
      .skip(skip)
      .take(limit);

    if (status !== undefined) {
      paymentsQuery.andWhere('payment.status = :status', { status });
    }

    if (method !== undefined) {
      paymentsQuery.andWhere('payment.method = :method', { method });
    }

    const [payments, total] = await paymentsQuery.getManyAndCount();

    return {
      items: payments.map((payment) => this.toCustomerResponse(payment)),
      meta: createPaginationMeta(page, limit, total),
    };
  }

  private async listPayments(
    query: ListPaymentsQueryDto,
    bookingId?: string,
    allowedMethods?: readonly PaymentMethod[],
  ): Promise<PaymentListResult> {
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const status = this.optionalStatus(query.status);
    const method = this.optionalMethod(query.method);
    const paymentsQuery = this.createQuery()
      .orderBy('payment.createdAt', 'DESC')
      .addOrderBy('payment.id', 'DESC')
      .skip(skip)
      .take(limit);

    if (bookingId !== undefined) {
      paymentsQuery.andWhere('payment.bookingId = :bookingId', { bookingId });
    }

    if (status !== undefined) {
      paymentsQuery.andWhere('payment.status = :status', { status });
    }

    if (method !== undefined && allowedMethods?.includes(method) === false) {
      paymentsQuery.andWhere('1 = 0');
    } else if (method !== undefined) {
      paymentsQuery.andWhere('payment.method = :method', { method });
    } else if (allowedMethods !== undefined) {
      paymentsQuery.andWhere('payment.method IN (:...allowedMethods)', {
        allowedMethods,
      });
    }

    const [payments, total] = await paymentsQuery.getManyAndCount();

    return {
      items: payments.map((payment) => this.toManagementResponse(payment)),
      meta: createPaginationMeta(page, limit, total),
    };
  }

  private createQuery(): SelectQueryBuilder<Payment> {
    return this.paymentRepo
      .createQueryBuilder('payment')
      .leftJoinAndSelect('payment.createdByUser', 'createdByUser')
      .leftJoinAndSelect('payment.refund', 'refund')
      .leftJoinAndSelect('refund.refundedByUser', 'refundedByUser');
  }

  private optionalMethod(value: unknown): PaymentMethod | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (
      typeof value !== 'string' ||
      !Object.values(PaymentMethod).includes(value as PaymentMethod)
    ) {
      throw new BadRequestException('Phuong thuc thanh toan khong hop le.');
    }

    return value as PaymentMethod;
  }

  private optionalStatus(value: unknown): PaymentStatus | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (
      typeof value !== 'string' ||
      !Object.values(PaymentStatus).includes(value as PaymentStatus)
    ) {
      throw new BadRequestException('Trang thai payment khong hop le.');
    }

    return value as PaymentStatus;
  }

  private requireActorId(value: string | undefined): string {
    if (value === undefined || !/^[1-9][0-9]*$/.test(value)) {
      throw new UnauthorizedException('Access token is invalid.');
    }

    return value;
  }

  private validateId(value: string, message: string): void {
    if (!/^[1-9][0-9]*$/.test(value)) {
      throw new BadRequestException(message);
    }
  }
}
