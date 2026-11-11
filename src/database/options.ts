import type { DataSourceOptions } from 'typeorm';
import { User } from '../auth/user.entity.js';
import { BookingIdempotency } from '../bookings/idempotency.entity.js';
import { Occupancy } from '../bookings/occupancy.entity.js';
import { Notification } from '../notifications/notification.entity.js';
import { ReminderJob } from '../notifications/reminder-job.entity.js';
import { Room } from '../rooms/room.entity.js';
import { CreateBookingSchema1760000000000 } from './migrations/1760000000000-create-booking-schema.js';

import { CreateAuthSchema1760000000001 } from './migrations/1760000000001-create-auth-schema.js';

export function databaseOptions(): DataSourceOptions {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const schema = process.env.DATABASE_SCHEMA || 'public';
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('DATABASE_SCHEMA must be a PostgreSQL identifier');
  return {
    type: 'postgres',
    url,
    schema,
    synchronize: false,
    installExtensions: false,
    uuidExtension: 'pgcrypto',
    entities: [User, Room, Occupancy, BookingIdempotency, Notification, ReminderJob],
    migrations: [CreateBookingSchema1760000000000, CreateAuthSchema1760000000001],
  };
}
