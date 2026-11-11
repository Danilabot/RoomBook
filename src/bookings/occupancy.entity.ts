import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type OccupancyKind = 'booking' | 'maintenance';
export type OccupancyStatus = 'active' | 'cancelled';

@Entity('occupancies')
export class Occupancy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'room_id' })
  roomId!: string;

  @Column({ type: 'uuid', name: 'owner_id', nullable: true })
  ownerId!: string | null;

  @Column({ type: 'text' })
  kind!: OccupancyKind;

  @Column({ type: 'text', default: 'active' })
  status!: OccupancyStatus;

  @Column({ type: 'timestamptz', name: 'starts_at' })
  start!: Date;

  @Column({ type: 'timestamptz', name: 'ends_at' })
  end!: Date;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'uuid', name: 'cancelled_by', nullable: true })
  cancelledBy!: string | null;

  @Column({ type: 'text', name: 'cancellation_reason', nullable: true })
  cancellationReason!: string | null;

  @Column({ type: 'timestamptz', name: 'cancelled_at', nullable: true })
  cancelledAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
