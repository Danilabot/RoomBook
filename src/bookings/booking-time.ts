import { BadRequestException, ConflictException } from '@nestjs/common';

const officeClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export interface Interval {
  start: Date;
  end: Date;
}

function parseTimestamp(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) throw new BadRequestException('Use ISO 8601 timestamps with a time zone offset');
  const [, year, month, day] = match;
  const calendarDate = new Date(year + '-' + month + '-' + day + 'T00:00:00Z');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || calendarDate.getUTCDate() !== Number(day)) {
    throw new BadRequestException('Invalid timestamp');
  }
  return date;
}

export function parseInterval(startValue: string, endValue: string): Interval {
  const start = parseTimestamp(startValue);
  const end = parseTimestamp(endValue);
  if (start >= end) throw new BadRequestException('End must be after start');
  return { start, end };
}

function officeTime(date: Date) {
  const parts = Object.fromEntries(officeClock.formatToParts(date).map(({ type, value }) => [type, value]));
  const milliseconds = (((Number(parts.hour) * 60 + Number(parts.minute)) * 60) + Number(parts.second)) * 1000
    + date.getUTCMilliseconds();
  return { day: parts.year + '-' + parts.month + '-' + parts.day, milliseconds };
}

export function validateBookingTime({ start, end }: Interval): void {
  const opening = officeTime(start);
  const closing = officeTime(end);
  const hour = 3_600_000;
  if (opening.day !== closing.day || opening.milliseconds < 8 * hour || closing.milliseconds > 20 * hour) {
    throw new BadRequestException('Bookings must be within 08:00–20:00 Europe/Moscow on one day');
  }
  if (end.getTime() - start.getTime() > 8 * hour) throw new BadRequestException('Bookings cannot exceed 8 hours');
}

export function validateFuture(interval: Interval): void {
  if (interval.start.getTime() <= Date.now()) throw new BadRequestException('Start must be in the future');
}

export function requireFutureActive(occupancy: Interval & { status: string }): void {
  if (occupancy.status !== 'active' || occupancy.start.getTime() <= Date.now()) {
    throw new ConflictException('Only active future reservations can be changed');
  }
}
