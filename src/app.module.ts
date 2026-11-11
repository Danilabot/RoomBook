import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthController } from './auth/auth.controller.js';
import { AuthSessions } from './auth/auth-sessions.js';
import { AUTH_SETTINGS, authSettings } from './auth/auth-settings.js';
import { OidcProvider } from './auth/oidc-provider.js';
import { PublicRoute, SessionGuard } from './auth/session.guard.js';
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

  @PublicRoute()
  @Get()
  async check() {
    await this.db.query('SELECT 1');
    return { status: 'ok' };
  }
}

@Module({
  imports: [TypeOrmModule.forRootAsync({ useFactory: databaseOptions })],
  controllers: [HealthController, AuthController, RoomsController, BookingsController, AdminBookingsController, MaintenanceController, NotificationsController],
  providers: [
    RoomsService, BookingsService, MaintenanceService, ReminderService, AdminGuard,
    { provide: AUTH_SETTINGS, useFactory: () => authSettings() },
    OidcProvider, AuthSessions, SessionGuard,
    { provide: APP_GUARD, useExisting: SessionGuard },
  ],
})
export class AppModule {}
