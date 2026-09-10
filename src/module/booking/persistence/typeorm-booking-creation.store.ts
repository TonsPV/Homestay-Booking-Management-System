import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { TransactionContext } from '../../../common/database/transaction';
import { getMysqlDuplicateKey } from '../../../common/database';
import { TypeOrmTransactionRunner } from '../../../common/database/typeorm-transaction.runner';
import { Customer } from '../../customer/schema/customer.entity';
import { Room } from '../../room/schema/room.entity';
import {
  BookingCreationStore,
  BookingCreationConflictError,
  BookingCustomerStore,
  BookingRoomStore,
  CustomerIdentityConflictError,
  type BookingRequestIntentLookup,
  type CreateBookingInput,
  type NewPasswordlessCustomer,
} from '../ports/booking-creation.store';
import { Booking } from '../schema/booking.entity';
import { BookingPaymentStatus, BookingStatus } from '../domain/booking-state';

@Injectable()
export class TypeOrmBookingCreationStore extends BookingCreationStore {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transactions: TypeOrmTransactionRunner,
  ) {
    super();
  }

  findRequestIntent(
    context: TransactionContext,
    lookup: BookingRequestIntentLookup,
  ): Promise<Booking | null> {
    return this.transactions
      .managerFor(context)
      .getRepository(Booking)
      .findOneBy({
        requestIntentActorType: lookup.actorType,
        requestIntentActorId: lookup.actorId,
        requestIntentKey: lookup.key,
      });
  }

  findRequestIntentSnapshot(
    lookup: BookingRequestIntentLookup,
  ): Promise<Booking | null> {
    return this.dataSource.getRepository(Booking).findOneBy({
      requestIntentActorType: lookup.actorType,
      requestIntentActorId: lookup.actorId,
      requestIntentKey: lookup.key,
    });
  }

  countActiveUnpaid(
    context: TransactionContext,
    customerId: string,
  ): Promise<number> {
    return this.transactions
      .managerFor(context)
      .getRepository(Booking)
      .countBy({
        customerId,
        status: BookingStatus.PENDING_PAYMENT,
        paymentStatus: BookingPaymentStatus.UNPAID,
      });
  }

  findActiveUnpaidStayRanges(
    context: TransactionContext,
    customerId: string,
  ): Promise<Array<Pick<Booking, 'checkInDate' | 'checkOutDate'>>> {
    return this.transactions
      .managerFor(context)
      .getRepository(Booking)
      .find({
        select: {
          checkInDate: true,
          checkOutDate: true,
        },
        where: {
          customerId,
          status: BookingStatus.PENDING_PAYMENT,
          paymentStatus: BookingPaymentStatus.UNPAID,
        },
      });
  }

  async createBooking(
    context: TransactionContext,
    input: CreateBookingInput,
  ): Promise<Booking> {
    const repository = this.transactions
      .managerFor(context)
      .getRepository(Booking);

    try {
      return await repository.save(repository.create(input));
    } catch (error) {
      const duplicateKey = getMysqlDuplicateKey(error);

      if (duplicateKey === undefined) {
        throw error;
      }

      throw new BookingCreationConflictError(
        duplicateKey.includes('uq_bookings_request_intent')
          ? 'REQUEST_INTENT'
          : 'OTHER',
      );
    }
  }
}

@Injectable()
export class TypeOrmBookingCustomerStore extends BookingCustomerStore {
  constructor(private readonly transactions: TypeOrmTransactionRunner) {
    super();
  }

  async findById(
    context: TransactionContext,
    customerId: string,
    lockForAdmission: boolean,
  ): Promise<Customer | null> {
    const query = this.transactions
      .managerFor(context)
      .getRepository(Customer)
      .createQueryBuilder('customer')
      .where('customer.id = :id', { id: customerId });

    if (lockForAdmission) {
      query.setLock('pessimistic_write');
    }

    return query.getOne();
  }

  findByPhoneVariants(
    context: TransactionContext,
    phones: string[],
  ): Promise<Customer | null> {
    return this.transactions
      .managerFor(context)
      .getRepository(Customer)
      .createQueryBuilder('customer')
      .where('customer.deletedAt IS NULL')
      .andWhere('customer.phone IN (:...phones)', { phones })
      .getOne();
  }

  findByEmail(
    context: TransactionContext,
    email: string,
  ): Promise<Customer | null> {
    return this.transactions
      .managerFor(context)
      .getRepository(Customer)
      .findOneBy({ email });
  }

  async createPasswordless(
    context: TransactionContext,
    input: NewPasswordlessCustomer,
  ): Promise<Customer> {
    const repository = this.transactions
      .managerFor(context)
      .getRepository(Customer);

    try {
      return await repository.save(
        repository.create({
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          passwordHash: null,
          status: 'ACTIVE',
        }),
      );
    } catch (error) {
      const duplicateKey = getMysqlDuplicateKey(error);

      if (duplicateKey === undefined) {
        throw error;
      }

      throw new CustomerIdentityConflictError(
        duplicateKey.includes('customers_phone')
          ? 'PHONE'
          : duplicateKey.includes('customers_email')
            ? 'EMAIL'
            : 'OTHER',
      );
    }
  }
}

@Injectable()
export class TypeOrmBookingRoomStore extends BookingRoomStore {
  constructor(private readonly transactions: TypeOrmTransactionRunner) {
    super();
  }

  findBookableForUpdate(
    context: TransactionContext,
    roomId: string,
  ): Promise<Room | null> {
    return this.transactions
      .managerFor(context)
      .getRepository(Room)
      .createQueryBuilder('room')
      .innerJoinAndSelect('room.roomType', 'roomType')
      .setLock('pessimistic_write')
      .where('room.id = :id', { id: roomId })
      .andWhere('room.deletedAt IS NULL')
      .andWhere('roomType.deletedAt IS NULL')
      .getOne();
  }
}
