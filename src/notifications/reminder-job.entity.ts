import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('reminder_jobs')
export class ReminderJob {
  @PrimaryColumn({ type: 'uuid', name: 'booking_id' })
  bookingId!: string;

  @Column({ type: 'timestamptz', name: 'due_at' })
  dueAt!: Date;

  @Column({ type: 'timestamptz', name: 'delivered_at', nullable: true })
  deliveredAt!: Date | null;
}
