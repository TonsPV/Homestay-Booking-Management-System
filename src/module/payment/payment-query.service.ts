import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, type Repository, type SelectQueryBuilder } from 'typeorm';

import type { PaginationMeta } from '../../common/http';
import { parsePagination } from '../../common/validation';
import { Booking } from '../booking/schema/booking.entity';
import type { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import type { CustomerPaymentResponse, PaymentResponse } from './payment.types';
import { Payment, PaymentMethod, PaymentStatus } from './schema/payment.entity';

export interface PaymentListResult {
  items: PaymentResponse[];
  meta: PaginationMeta;
}

export interface CustomerPaymentListResult {
  items: CustomerPaymentResponse[];
  meta: PaginationMeta;
}

export interface PaymentManagementListResult {
  items: PaymentResponse[];
  meta: PaginationMeta & {
    staleRefundCount: number;
  };
}

@Injectable()
export class PaymentQueryService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
  ) {}

  async listForCustomer(
    customerId: string | undefined,
    bookingId: string,
    query: ListPaymentsQueryDto,
  ): Promise<CustomerPaymentListResult> {
    const activeCustomerId = this.requireActorId(customerId);
    this.validateId(bookingId, 'Booking id khong hop le.');
    const booking = await this.bookingsRepository.findOneBy({ id: bookingId });

    if (booking === null || booking.customerId !== activeCustomerId) {
      throw new NotFoundException('Khong tim thay booking.');
    }

    return this.listCustomerPayments(bookingId, query);
  }

  async listManagement(
    bookingId: string,
    query: ListPaymentsQueryDto,
  ): Promise<PaymentListResult> {
    this.validateId(bookingId, 'Booking id khong hop le.');

    if (
      (await this.bookingsRepository.exists({
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
  ): Promise<PaymentManagementListResult> {
    const [result, staleRefundCount] = await Promise.all([
      this.listPayments(query, undefined, allowedMethods),
      allowedMethods === undefined ? this.countStaleRefunds() : 0,
    ]);

    return {
      ...result,
      meta: {
        ...result.meta,
        staleRefundCount,
      },
    };
  }

  async getManagementPayment(id: string): Promise<PaymentResponse> {
    return this.toResponse(await this.getPaymentEntity(id));
  }

  countStaleRefunds(now = new Date()): Promise<number> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    return this.paymentsRepository.countBy({
      status: PaymentStatus.REFUND_PENDING,
      refundRequestedAt: LessThan(sevenDaysAgo),
    });
  }

  async getPaymentEntity(id: string): Promise<Payment> {
    const payment = await this.createPaymentQuery()
      .where('payment.id = :id', { id })
      .getOne();

    if (payment === null) {
      throw new NotFoundException('Khong tim thay payment.');
    }

    return payment;
  }

  toResponse(payment: Payment): PaymentResponse {
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
      refundRequestId: payment.refundRequestId,
      refundPreviousStatus: payment.refundPreviousStatus,
      refundGatewayTransactionId: payment.refundGatewayTransactionId,
      refundResponseCode: payment.refundResponseCode,
      refundTransactionStatus: payment.refundTransactionStatus,
      refundMessage: payment.refundMessage,
      refundReason: payment.refundReason,
      createdByUserId: payment.createdByUserId,
      refundedByUserId: payment.refundedByUserId,
      paidAt: payment.paidAt,
      refundedAt: payment.refundedAt,
      refundRequestedAt: payment.refundRequestedAt,
      refundLastQueriedAt: payment.refundLastQueriedAt,
      expiresAt: payment.expiresAt,
      createdByUser:
        payment.createdByUser === null
          ? null
          : {
              id: payment.createdByUser.id,
              fullName: payment.createdByUser.fullName,
            },
      refundedByUser:
        payment.refundedByUser === null
          ? null
          : {
              id: payment.refundedByUser.id,
              fullName: payment.refundedByUser.fullName,
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
      refundedAt: payment.refundedAt,
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

  private async listCustomerPayments(
    bookingId: string,
    query: ListPaymentsQueryDto,
  ): Promise<CustomerPaymentListResult> {
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const status = this.optionalPaymentStatus(query.status);
    const method = this.optionalPaymentMethod(query.method);
    const paymentsQuery = this.paymentsRepository
      .createQueryBuilder('payment')
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
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
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
    const status = this.optionalPaymentStatus(query.status);
    const method = this.optionalPaymentMethod(query.method);
    const paymentsQuery = this.createPaymentQuery()
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
      items: payments.map((payment) => this.toResponse(payment)),
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  private createPaymentQuery(): SelectQueryBuilder<Payment> {
    return this.paymentsRepository
      .createQueryBuilder('payment')
      .leftJoinAndSelect('payment.createdByUser', 'createdByUser')
      .leftJoinAndSelect('payment.refundedByUser', 'refundedByUser');
  }

  private optionalPaymentMethod(value: unknown): PaymentMethod | undefined {
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

  private optionalPaymentStatus(value: unknown): PaymentStatus | undefined {
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
