import type { EntityManager } from 'typeorm';
import type { Interval } from './booking-time.js';
import { Occupancy } from './occupancy.entity.js';

export function activeOverlaps(manager: EntityManager, { start, end }: Interval) {
  return manager.getRepository(Occupancy).createQueryBuilder('occupancy')
    .where({ status: 'active' })
    .andWhere("tstzrange(occupancy.start, occupancy.end, '[)') && tstzrange(:start, :end, '[)')", { start, end });
}

export function overlappingOccupancies(manager: EntityManager, roomId: string, interval: Interval) {
  return activeOverlaps(manager, interval)
    .andWhere({ roomId })
    .orderBy('occupancy.start', 'ASC');
}
