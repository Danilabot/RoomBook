import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentActor, type Actor } from '../auth/actor.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { CancellationReason, CreateBooking, UpdateBooking } from './booking.dto.js';
import { BookingsService } from './bookings.service.js';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.bookings.list(actor.id);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateBooking) {
    return this.bookings.create(actor.id, key, input);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.get(id, actor.id);
  }

  @Patch(':id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateBooking) {
    return this.bookings.update(id, actor.id, input);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.cancel(id, actor.id);
  }
}

@Controller('admin/bookings')
@UseGuards(AdminGuard)
export class AdminBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  list() {
    return this.bookings.list();
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() input: CancellationReason) {
    return this.bookings.cancel(id, actor.id, input.reason);
  }
}
