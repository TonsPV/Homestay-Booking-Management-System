import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { BedType } from '../bed-configuration';
import { RoomType } from './room-type.entity';

@Entity('room_type_beds')
@Index('uq_room_type_beds_room_type_bed_type', ['roomTypeId', 'bedType'], {
  unique: true,
})
@Check('chk_room_type_beds_quantity', 'quantity > 0')
@Check(
  'chk_room_type_beds_bed_type',
  `bed_type IN ('SINGLE','DOUBLE','QUEEN','KING','BUNK','SOFA_BED')`,
)
export class RoomTypeBed {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'room_type_id', type: 'bigint' })
  roomTypeId: string;

  @ManyToOne(() => RoomType, (roomType) => roomType.beds, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'room_type_id',
    foreignKeyConstraintName: 'fk_room_type_beds_room_type',
  })
  roomType: RoomType;

  @Column({ name: 'bed_type', type: 'varchar', length: 30 })
  bedType: BedType;

  @Column({ type: 'int' })
  quantity: number;
}
