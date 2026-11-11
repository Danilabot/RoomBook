import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CurrentActor, type Actor } from '../auth/actor.js';
import { Notification } from './notification.entity.js';

function notificationResponse({ id, bookingId, type, title, readAt, createdAt }: Notification) {
  return { id, bookingId, type, title, readAt, createdAt };
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly db: DataSource) {}

  @Get()
  async list(@CurrentActor() actor: Actor) {
    const notifications = await this.db.getRepository(Notification).find({
      where: { userId: actor.id },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return notifications.map(notificationResponse);
  }

  @Patch(':id/read')
  async markRead(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    const repo = this.db.getRepository(Notification);
    await repo.createQueryBuilder().update().set({ readAt: () => 'COALESCE(read_at, now())' })
      .where({ id, userId: actor.id }).execute();
    const notification = await repo.findOneBy({ id, userId: actor.id });
    if (!notification) throw new NotFoundException('Notification not found');
    return notificationResponse(notification);
  }
}
