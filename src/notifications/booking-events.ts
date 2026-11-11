import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { Occupancy } from '../bookings/occupancy.entity.js';
import { Notification, type NotificationType } from './notification.entity.js';
import { ReminderJob } from './reminder-job.entity.js';

const reminderLeadTime = 30 * 60 * 1000;

export async function writeBookingEvent(
  manager: EntityManager,
  booking: Occupancy,
  type: Exclude<NotificationType, 'booking_reminder'>,
  scheduleReminder = false,
): Promise<void> {
  if (!booking.ownerId) throw new Error('Booking notifications require an owner');
  const eventKey = type + ':' + booking.id + (type === 'booking_updated' ? ':' + randomUUID() : '');
  await manager.getRepository(Notification).insert({
    eventKey,
    userId: booking.ownerId,
    bookingId: booking.id,
    type,
    title: booking.title,
  });

  const jobs = manager.getRepository(ReminderJob);
  if (type === 'booking_cancelled') {
    await jobs.delete({ bookingId: booking.id });
  } else if (scheduleReminder) {
    const dueAt = new Date(booking.start.getTime() - reminderLeadTime);
    await jobs.upsert({ bookingId: booking.id, dueAt, deliveredAt: null }, ['bookingId']);
  }
}
