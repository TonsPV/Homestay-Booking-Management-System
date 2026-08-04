import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Customer } from '../../customer/schema/customer.entity';

export enum CustomerClaimPurpose {
  CLAIM_ACCOUNT = 'CLAIM_ACCOUNT',
}

export enum CustomerClaimChallengeStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  CONSUMED = 'CONSUMED',
  EXPIRED = 'EXPIRED',
  BLOCKED = 'BLOCKED',
}

@Entity('customer_claim_challenges')
@Index('idx_customer_claim_customer_purpose_status', [
  'customerId',
  'purpose',
  'status',
])
@Index('idx_customer_claim_phone_purpose_created', [
  'phoneSnapshot',
  'purpose',
  'createdAt',
])
@Index('idx_customer_claim_status_expires', ['status', 'expiresAt'])
export class CustomerClaimChallenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id', type: 'bigint' })
  customerId: string;

  @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'customer_id',
    foreignKeyConstraintName: 'fk_customer_claim_challenges_customer',
  })
  customer: Customer;

  @Column({ name: 'phone_snapshot', type: 'varchar', length: 30 })
  phoneSnapshot: string;

  @Column({ name: 'otp_hash', type: 'varchar', length: 255, select: false })
  otpHash: string;

  @Column({
    name: 'claim_token_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
    select: false,
  })
  claimTokenHash: string | null;

  @Column({ type: 'enum', enum: CustomerClaimPurpose })
  purpose: CustomerClaimPurpose;

  @Column({ type: 'enum', enum: CustomerClaimChallengeStatus })
  status: CustomerClaimChallengeStatus;

  @Column({ name: 'attempt_count', type: 'int', unsigned: true, default: 0 })
  attemptCount: number;

  @Column({ name: 'expires_at', type: 'datetime', precision: 6 })
  expiresAt: Date;

  @Column({
    name: 'verified_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  verifiedAt: Date | null;

  @Column({
    name: 'claim_token_expires_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  claimTokenExpiresAt: Date | null;

  @Column({
    name: 'consumed_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  consumedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 })
  updatedAt: Date;
}
