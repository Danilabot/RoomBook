import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { isOccupancyConflict } from '../database/postgres-errors.js';
import { writeBookingEvent } from '../notifications/booking-events.js';
import { lockBookableRoom } from '../rooms/rooms.service.js';
import type { CreateBooking, UpdateBooking } from './booking.dto.js';
import { bookingResponse, type BookingResponse } from './booking-response.js';
import { parseInterval, requireFutureActive, validateBookingTime, validateFuture } from './booking-time.js';
import { BookingIdempotency } from './idempotency.entity.js';
import { Occupancy } from './occupancy.entity.js';

const busy = () => new ConflictException('Room is already occupied for this time');

@Injectable()
export class BookingsService {
  constructor(private readonly db: DataSource) {}

  async create(ownerId: string, key: string | undefined, input: CreateBooking): Promise<BookingResponse> {
    if (typeof key !== 'string' || !/^[\x21-\x2b\x2d-\x7e]{1,128}$/.test(key)) {
      throw new BadRequestException('Idempotency-Key must contain 1–128 visible ASCII characters excluding commas');
    }
    const interval = parseInterval(input.start, input.end);
    const normalized = {
      roomId: input.roomId.toLowerCase(),
      title: input.title,
      description: input.description || null,
      ...interval,
    };
    const fingerprint = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');

    try {
      return await this.db.transaction(async (manager) => {
        const keys = manager.getRepository(BookingIdempotency);
        const where = { userId: ownerId, key };
        await keys.createQueryBuilder().insert().values({ ...where, fingerprint }).orIgnore().execute();
        const record = await keys.findOneByOrFail(where);
        if (record.fingerprint !== fingerprint) throw new ConflictException('Idempotency-Key has a different request body');
        if (record.outcome) return record.outcome;

        await lockBookableRoom(manager, normalized.roomId);
        validateFuture(interval);
        validateBookingTime(interval);
        const occupancies = manager.getRepository(Occupancy);
        const booking = await occupancies.save(occupancies.create({
          ...normalized,
          ownerId,
          kind: 'booking',
          status: 'active',
          cancelledAt: null,
          cancelledBy: null,
          cancellationReason: null,
        }));
        await writeBookingEvent(manager, booking, 'booking_created', true);
        const outcome = bookingResponse(booking);
        await keys.update(where, { outcome });
        return outcome;
      });
    } catch (error) {
      if (isOccupancyConflict(error)) throw busy();
      throw error;
    }
  }

  list(ownerId?: string): Promise<Occupancy[]> {
    return this.db.getRepository(Occupancy).find({
      where: { kind: 'booking', ...(ownerId ? { ownerId } : {}) },
      order: { start: 'DESC', id: 'DESC' },
    });
  }

  async get(id: string, ownerId: string): Promise<Occupancy> {
    const booking = await this.db.getRepository(Occupancy).findOneBy({ id, ownerId, kind: 'booking' });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  async update(id: string, ownerId: string, input: UpdateBooking): Promise<Occupancy> {
    try {
      return await this.db.transaction(async (manager) => {
        const booking = await this.lockBooking(manager, id, ownerId);
        requireFutureActive(booking);
        const interval = parseInterval(input.start ?? booking.start.toISOString(), input.end ?? booking.end.toISOString());
        const roomId = input.roomId?.toLowerCase() ?? booking.roomId;
        const scheduleChanged = interval.start.getTime() !== booking.start.getTime();
        const intervalChanged = scheduleChanged || interval.end.getTime() !== booking.end.getTime();
        if (roomId !== booking.roomId || intervalChanged) await lockBookableRoom(manager, roomId);
        validateFuture(interval);
        validateBookingTime(interval);

        const title = input.title ?? booking.title;
        const description = input.description === undefined ? booking.description : input.description || null;
        if (!intervalChanged && roomId === booking.roomId && title === booking.title && description === booking.description) {
          return booking;
        }
        Object.assign(booking, { ...interval, roomId, title, description });
        const saved = await manager.getRepository(Occupancy).save(booking);
        await writeBookingEvent(manager, saved, 'booking_updated', scheduleChanged);
        return saved;
      });
    } catch (error) {
      if (isOccupancyConflict(error)) throw busy();
      throw error;
    }
  }

  cancel(id: string, actorId: string, reason?: string): Promise<Occupancy> {
    return this.db.transaction(async (manager) => {
      const booking = await this.lockBooking(manager, id, reason === undefined ? actorId : undefined);
      requireFutureActive(booking);
      booking.status = 'cancelled';
      booking.cancelledAt = new Date();
      booking.cancelledBy = actorId;
      booking.cancellationReason = reason ?? null;
      const cancelled = await manager.getRepository(Occupancy).save(booking);
      await writeBookingEvent(manager, cancelled, 'booking_cancelled');
      return cancelled;
    });
  }

  private async lockBooking(manager: EntityManager, id: string, ownerId?: string): Promise<Occupancy> {
    const booking = await manager.getRepository(Occupancy).findOne({
      where: { id, kind: 'booking', ...(ownerId ? { ownerId } : {}) },
      lock: { mode: 'pessimistic_write' },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }
}
