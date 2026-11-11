import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, LessThanOrEqual } from 'typeorm';
import { Occupancy } from '../bookings/occupancy.entity.js';
import { Notification } from './notification.entity.js';
import { ReminderJob } from './reminder-job.entity.js';

@Injectable()
export class ReminderService {
  constructor(private readonly db: DataSource) {}

  deliverDue(batchSize = 50): Promise<number> {
    return this.db.transaction(async (manager) => {
      const now = new Date();
      const jobs = manager.getRepository(ReminderJob);
      const batch = await jobs.createQueryBuilder('job')
        .where({ deliveredAt: IsNull(), dueAt: LessThanOrEqual(now) })
        .orderBy('job.dueAt', 'ASC')
        .addOrderBy('job.bookingId', 'ASC')
        .take(batchSize)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      let delivered = 0;
      for (const job of batch) {
        const booking = await manager.getRepository(Occupancy).findOneByOrFail({ id: job.bookingId });
        if (booking.ownerId && booking.status === 'active' && booking.start > now) {
          await manager.getRepository(Notification).createQueryBuilder().insert().values({
            eventKey: 'booking_reminder:' + booking.id + ':' + job.dueAt.toISOString(),
            userId: booking.ownerId,
            bookingId: booking.id,
            title: booking.title,
            type: 'booking_reminder',
          }).orIgnore().execute();
          delivered += 1;
        }
        await jobs.update({ bookingId: job.bookingId }, { deliveredAt: now });
      }
      return delivered;
    });
  }
}
