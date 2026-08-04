import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Room } from '../../room/schema/room.entity';
import { Booking } from './booking.entity';

export enum RoomCalendarStatus {
  RESERVED = 'RESERVED',
  BLOCKED = 'BLOCKED',
}

@Entity('room_calendar')
@Index('uq_room_calendar_room_date', ['roomId', 'stayDate'], {
  unique: true,
})
@Index('idx_room_calendar_booking', ['bookingId'])
@Index('idx_room_calendar_date', ['stayDate'])
@Index('idx_room_calendar_status', ['status'])
@Index('idx_room_calendar_status_date', ['status', 'stayDate'])
@Check(
  'chk_room_calendar_status_ownership',
  "(status = 'RESERVED' AND booking_id IS NOT NULL) OR (status = 'BLOCKED' AND booking_id IS NULL)",
)
export class RoomCalendar {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'room_id', type: 'bigint' })
  roomId: string;

  @ManyToOne(() => Room, { nullable: false })
  @JoinColumn({
    name: 'room_id',
    foreignKeyConstraintName: 'room_calendar_ibfk_1',
  })
  room: Room;

  @Column({ name: 'booking_id', type: 'bigint', nullable: true })
  bookingId: string | null;

  @ManyToOne(() => Booking, { nullable: true })
  @JoinColumn({
    name: 'booking_id',
    foreignKeyConstraintName: 'fk_room_calendar_booking',
  })
  booking: Booking | null;

  @Column({ name: 'stay_date', type: 'date' })
  stayDate: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: RoomCalendarStatus.RESERVED,
  })
  status: RoomCalendarStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;
}
