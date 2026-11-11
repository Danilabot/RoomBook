import { Controller, Get, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AdminGuard } from './auth/admin.guard.js';
import { AdminBookingsController, BookingsController } from './bookings/bookings.controller.js';
import { BookingsService } from './bookings/bookings.service.js';
import { MaintenanceController } from './bookings/maintenance.controller.js';
import { MaintenanceService } from './bookings/maintenance.service.js';
import { databaseOptions } from './database/options.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { ReminderService } from './notifications/reminder.service.js';
import { RoomsController } from './rooms/rooms.controller.js';
import { RoomsService } from './rooms/rooms.service.js';

@Controller('health')
class HealthController {
  constructor(private readonly db: DataSource) {}

  @Get()
  async check() {
    await this.db.query('SELECT 1');
    return { status: 'ok' };
  }
}

@Module({
  imports: [TypeOrmModule.forRootAsync({ useFactory: databaseOptions })],
  controllers: [HealthController, RoomsController, BookingsController, AdminBookingsController, MaintenanceController, NotificationsController],
  providers: [RoomsService, BookingsService, MaintenanceService, ReminderService, AdminGuard],
})
export class AppModule {}
