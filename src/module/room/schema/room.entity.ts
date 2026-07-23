import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { RoomType } from '../../room-type/schema/room-type.entity';
import { RoomImage } from './room-image.entity';

export enum RoomStatus {
  READY = 'READY',
  OCCUPIED = 'OCCUPIED',
  CLEANING = 'CLEANING',
  MAINTENANCE = 'MAINTENANCE',
  HIDDEN = 'HIDDEN',
}

@Entity('rooms')
@Index('uq_rooms_room_number', ['roomNumber'], { unique: true })
@Index('idx_rooms_room_type', ['roomTypeId'])
@Index('idx_rooms_status', ['status'])
export class Room {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'room_type_id', type: 'bigint' })
  roomTypeId: string;

  @ManyToOne(() => RoomType, { nullable: false })
  @JoinColumn({
    name: 'room_type_id',
    foreignKeyConstraintName: 'rooms_ibfk_1',
  })
  roomType: RoomType;

  @Column({ name: 'room_number', type: 'varchar', length: 50 })
  roomNumber: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: RoomStatus,
    default: RoomStatus.READY,
  })
  status: RoomStatus;

  @OneToMany(() => RoomImage, (image) => image.room)
  images: RoomImage[];

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'datetime', nullable: true })
  deletedAt: Date | null;
}
