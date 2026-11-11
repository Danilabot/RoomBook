import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { isOccupancyConflict } from '../database/postgres-errors.js';
import { lockBookableRoom } from '../rooms/rooms.service.js';
import type { CreateMaintenance } from './booking.dto.js';
import { parseInterval, requireFutureActive, validateFuture, type Interval } from './booking-time.js';
import { Occupancy } from './occupancy.entity.js';

export function overlappingOccupancies(manager: EntityManager, roomId: string, { start, end }: Interval) {
  return manager.getRepository(Occupancy).createQueryBuilder('occupancy')
    .where({ roomId, status: 'active' })
    .andWhere("tstzrange(occupancy.start, occupancy.end, '[)') && tstzrange(:start, :end, '[)')", { start, end })
    .orderBy('occupancy.start', 'ASC');
}

function maintenanceConflict(conflicts: Occupancy[]): ConflictException {
  return new ConflictException({ statusCode: 409, message: 'Maintenance conflicts with existing occupancy', conflicts });
}

@Injectable()
export class MaintenanceService {
  constructor(private readonly db: DataSource) {}

  list(roomId: string): Promise<Occupancy[]> {
    return this.db.getRepository(Occupancy).find({
      where: { roomId, kind: 'maintenance' },
      order: { start: 'DESC', id: 'DESC' },
    });
  }

  async create(roomId: string, input: CreateMaintenance): Promise<Occupancy> {
    const interval = parseInterval(input.start, input.end);
    try {
      return await this.db.transaction(async (manager) => {
        await lockBookableRoom(manager, roomId);
        validateFuture(interval);
        const conflicts = await overlappingOccupancies(manager, roomId, interval).getMany();
        if (conflicts.length) throw maintenanceConflict(conflicts);
        const occupancies = manager.getRepository(Occupancy);
        return occupancies.save(occupancies.create({
          ...interval, roomId, ownerId: null, title: input.reason, kind: 'maintenance', status: 'active',
        }));
      });
    } catch (error) {
      if (isOccupancyConflict(error)) {
        const conflicts = await overlappingOccupancies(this.db.manager, roomId, interval).getMany();
        throw maintenanceConflict(conflicts);
      }
      throw error;
    }
  }

  remove(id: string, adminId: string): Promise<Occupancy> {
    return this.db.transaction(async (manager) => {
      const occupancies = manager.getRepository(Occupancy);
      const window = await occupancies.findOne({
        where: { id, kind: 'maintenance' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!window) throw new NotFoundException('Maintenance not found');
      requireFutureActive(window);
      window.status = 'cancelled';
      window.cancelledAt = new Date();
      window.cancelledBy = adminId;
      return occupancies.save(window);
    });
  }
}
