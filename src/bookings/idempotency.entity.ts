import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { BookingResponse } from './booking-response.js';

@Entity('booking_idempotency')
export class BookingIdempotency {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @PrimaryColumn({ type: 'text', name: 'request_key' })
  key!: string;

  @Column({ type: 'text' })
  fingerprint!: string;

  @Column({ type: 'jsonb', nullable: true })
  outcome!: BookingResponse | null;
}
