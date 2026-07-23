import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Room } from './room.entity';

@Entity('room_images')
@Index('idx_room_images_room', ['roomId'])
@Index('idx_room_images_cover', ['roomId', 'isCover'])
export class RoomImage {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'room_id', type: 'bigint' })
  roomId: string;

  @ManyToOne(() => Room, (room) => room.images, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'room_id',
    foreignKeyConstraintName: 'room_images_ibfk_1',
  })
  room: Room;

  @Column({ name: 'image_url', type: 'varchar', length: 500 })
  imageUrl: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_cover', type: 'boolean', default: false })
  isCover: boolean;
}
