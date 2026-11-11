import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { parseInterval } from '../bookings/booking-time.js';
import { activeOverlaps } from '../bookings/occupancy-query.js';
import { Room } from './room.entity.js';
import type { CreateRoom, RoomFilters, UpdateRoom } from './room.dto.js';

export async function lockRoom(manager: EntityManager, id: string): Promise<Room> {
  const room = await manager.getRepository(Room).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
  if (!room) throw new NotFoundException('Room not found');
  return room;
}

export async function lockBookableRoom(manager: EntityManager, id: string): Promise<void> {
  const room = await lockRoom(manager, id);
  if (room.archived) throw new ConflictException('Room is archived');
}

function normalizeEquipment(equipment: string[]): string[] {
  const labels = new Map<string, string>();
  for (const item of equipment) {
    const key = item.toLowerCase();
    if (!labels.has(key)) labels.set(key, item);
  }
  return [...labels.values()];
}

@Injectable()
export class RoomsService {
  constructor(private readonly db: DataSource) {}

  list(filters: RoomFilters, includeArchived: boolean): Promise<Room[]> {
    const query = this.db.getRepository(Room).createQueryBuilder('room').orderBy('room.name', 'ASC').addOrderBy('room.id', 'ASC');
    if (!includeArchived) query.andWhere('NOT room.archived');
    if (filters.minCapacity !== undefined) query.andWhere('room.capacity >= :capacity', { capacity: filters.minCapacity });
    if (filters.search) {
      query.andWhere(
        "(strpos(lower(room.name), lower(:search)) > 0 OR strpos(lower(room.location), lower(:search)) > 0 OR strpos(lower(coalesce(room.description, '')), lower(:search)) > 0)",
        { search: filters.search },
      );
    }
    const equipment = filters.equipment?.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (equipment?.length) {
      query.andWhere('ARRAY(SELECT lower(item) FROM unnest(room.equipment) AS items(item)) @> CAST(:equipment AS text[])', { equipment });
    }
    const { start, end } = filters;
    if (start !== undefined || end !== undefined) {
      if (start === undefined || end === undefined) throw new BadRequestException('Provide both start and end to filter availability');
      const overlaps = activeOverlaps(this.db.manager, parseInterval(start, end))
        .select('1')
        .andWhere('occupancy.roomId = room.id');
      query.andWhere('NOT EXISTS (' + overlaps.getQuery() + ')', overlaps.getParameters());
    }
    return query.getMany();
  }

  async get(id: string, includeArchived: boolean): Promise<Room> {
    const room = await this.db.getRepository(Room).findOneBy({ id, ...(includeArchived ? {} : { archived: false }) });
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  create(input: CreateRoom): Promise<Room> {
    const rooms = this.db.getRepository(Room);
    return rooms.save(rooms.create({ ...input, equipment: normalizeEquipment(input.equipment), description: input.description ?? null }));
  }

  update(id: string, input: UpdateRoom): Promise<Room> {
    return this.db.transaction(async (manager) => {
      const room = await lockRoom(manager, id);
      const rooms = manager.getRepository(Room);
      rooms.merge(room, input);
      if (input.equipment) room.equipment = normalizeEquipment(input.equipment);
      return rooms.save(room);
    });
  }
}
