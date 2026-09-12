import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Customer } from '../../customer/schema/customer.entity';

/**
 * A provider identity is deliberately separate from the Customer contact
 * fields. Provider subjects are stable identifiers; provider email addresses
 * are profile data and must not be used as the account key.
 */
@Entity('customer_auth_identities')
@Index(
  'uq_customer_auth_identity_provider_subject',
  ['provider', 'providerSubject'],
  {
    unique: true,
  },
)
@Index(
  'uq_customer_auth_identity_customer_provider',
  ['customerId', 'provider'],
  {
    unique: true,
  },
)
@Index('idx_customer_auth_identity_customer', ['customerId'])
export class CustomerAuthIdentity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'customer_id', type: 'bigint' })
  customerId: string;

  @ManyToOne(() => Customer, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({
    name: 'customer_id',
    foreignKeyConstraintName: 'customer_auth_identities_ibfk_1',
  })
  customer: Customer;

  @Column({ type: 'varchar', length: 32 })
  provider: string;

  @Column({
    collation: 'utf8mb4_bin',
    name: 'provider_subject',
    type: 'varchar',
    length: 255,
  })
  providerSubject: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt: Date;
}
