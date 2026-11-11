import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentActor, type Actor } from '../auth/actor.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { CreateMaintenance } from './booking.dto.js';
import { MaintenanceService } from './maintenance.service.js';

@Controller('admin')
@UseGuards(AdminGuard)
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get('rooms/:id/maintenance')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.maintenance.list(id);
  }

  @Post('rooms/:id/maintenance')
  create(@Param('id', ParseUUIDPipe) id: string, @Body() input: CreateMaintenance) {
    return this.maintenance.create(id, input);
  }

  @Delete('maintenance/:id')
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.maintenance.remove(id, actor.id);
  }
}
