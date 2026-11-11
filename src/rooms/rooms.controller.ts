import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CurrentActor, requireAdmin, type Actor } from '../auth/actor.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { TimeWindow } from '../bookings/booking.dto.js';
import { parseInterval } from '../bookings/booking-time.js';
import { overlappingOccupancies } from '../bookings/maintenance.service.js';
import { CreateRoom, RoomFilters, UpdateRoom } from './room.dto.js';
import { RoomsService } from './rooms.service.js';

@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService, private readonly db: DataSource) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() filters: RoomFilters) {
    if (filters.includeArchived) requireAdmin(actor);
    return this.rooms.list(filters, filters.includeArchived ?? false);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.rooms.get(id, actor.roles.includes('admin'));
  }

  @Get(':id/availability')
  async availability(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() query: TimeWindow) {
    const interval = parseInterval(query.start, query.end);
    await this.rooms.get(id, actor.roles.includes('admin'));
    const occupancies = await overlappingOccupancies(this.db.manager, id, interval)
      .select(['occupancy.start', 'occupancy.end', 'occupancy.kind']).getMany();
    return occupancies.map(({ start, end, kind }) => ({ start, end, kind }));
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() input: CreateRoom) {
    return this.rooms.create(input);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateRoom) {
    return this.rooms.update(id, input);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  archive(@Param('id', ParseUUIDPipe) id: string) {
    return this.rooms.update(id, { archived: true });
  }
}
