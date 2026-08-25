import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Amenity } from '../../amenity/schema/amenity.entity';
import { RoomTypeBed } from './room-type-bed.entity';

@Entity('room_types')
@Index('uq_room_types_name', ['name'], { unique: true })
@Check('chk_room_types_max_guests', 'max_guests > 0')
@Check('chk_room_types_base_price', 'base_price > 0')
export class RoomType {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'bed_type', type: 'varchar', length: 120, nullable: true })
  bedType: string | null;

  @OneToMany(() => RoomTypeBed, (bed) => bed.roomType)
  beds: RoomTypeBed[];

  @Column({ name: 'max_guests', type: 'int' })
  maxGuests: number;

  @Column({ name: 'base_price', type: 'decimal', precision: 12, scale: 2 })
  basePrice: string;

  @ManyToMany(() => Amenity, (amenity) => amenity.roomTypes)
  @JoinTable({
    name: 'room_type_amenities',
    joinColumn: {
      name: 'room_type_id',
      referencedColumnName: 'id',
      foreignKeyConstraintName: 'fk_room_type_amenities_room_type',
    },
    inverseJoinColumn: {
      name: 'amenity_id',
      referencedColumnName: 'id',
      foreignKeyConstraintName: 'fk_room_type_amenities_amenity',
    },
  })
  amenities: Amenity[];

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'datetime', nullable: true })
  deletedAt: Date | null;
}
