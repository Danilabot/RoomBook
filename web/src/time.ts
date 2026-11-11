import type { Interval } from './api';

const timeZone = 'Europe/Moscow';
const dateInputFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
});
const clock = new Intl.DateTimeFormat('ru-RU', {
  timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const dateLabel = new Intl.DateTimeFormat('ru-RU', {
  timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});

export const officeDay = (date: Date | string | number = new Date()) => dateInputFormat.format(new Date(date));
export const officeClock = (date: Date | string | number) => clock.format(new Date(date));
export const officeInput = (date: Date | string | number) => officeDay(date) + 'T' + officeClock(date);

// All editable timestamps are modern Moscow dates. Round-trip validation also
// rejects normalized input such as February 30 and dates with older offsets.
export function officeInstant(input: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) return null;
  const date = new Date(input + ':00+03:00');
  return Number.isFinite(date.getTime()) && officeInput(date) === input ? date.toISOString() : null;
}

export function stepDay(day: string, direction: number) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + direction);
  return date.toISOString().slice(0, 10);
}

export function dayTitle(day: string) {
  return dateLabel.format(new Date(day + 'T12:00:00Z'));
}

export function displayRange(start: string, end: string) {
  const first = dayTitle(officeDay(start)) + ', ' + officeClock(start);
  return officeDay(start) === officeDay(end)
    ? first + '–' + officeClock(end)
    : first + ' — ' + dayTitle(officeDay(end)) + ', ' + officeClock(end);
}

export function parseRange(from: string, to: string, mode: 'filter' | 'booking' | 'maintenance') {
  const start = officeInstant(from);
  const end = officeInstant(to);
  if (!start || !end) throw 'Укажите начало и окончание интервала.';
  if (end <= start) throw 'Окончание должно быть позже начала.';
  if (mode !== 'filter' && Date.parse(start) <= Date.now()) throw 'Время начала должно быть в будущем.';
  if (mode === 'booking') {
    if (from.slice(0, 10) !== to.slice(0, 10) || from.slice(11) < '08:00' || to.slice(11) > '20:00') {
      throw 'Бронирование должно быть в пределах одного дня, с 08:00 до 20:00 по Москве.';
    }
    if (Date.parse(end) - Date.parse(start) > 8 * 60 * 60 * 1000) throw 'Бронирование может длиться до 8 часов.';
  }
  return { start, end };
}

export type Segment = { start: number; end: number; kind: Interval['kind'] | 'free' };

export function schedule(day: string, intervals: Interval[]): Segment[] {
  const first = Date.parse(officeInstant(day + 'T08:00')!);
  const last = Date.parse(officeInstant(day + 'T20:00')!);
  const occupied = intervals.map(({ start, end, kind }) => ({
    start: Math.max(first, Date.parse(start)), end: Math.min(last, Date.parse(end)), kind,
  })).filter(({ start, end }) => start < end).sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = first;
  for (const item of occupied) {
    if (cursor < item.start) segments.push({ start: cursor, end: item.start, kind: 'free' });
    if (cursor < item.end) segments.push({ ...item, start: Math.max(cursor, item.start) });
    cursor = Math.max(cursor, item.end);
  }
  if (cursor < last) segments.push({ start: cursor, end: last, kind: 'free' });
  return segments;
}

export function nextSlot(day: string) {
  const opening = Date.parse(officeInstant(day + 'T08:00')!);
  const closing = Date.parse(officeInstant(day + 'T20:00')!);
  const quarter = 15 * 60 * 1000;
  const start = Math.max(opening, Math.ceil((Date.now() + 1) / quarter) * quarter);
  return start < closing
    ? { start: officeInput(start), end: officeInput(Math.min(start + 4 * quarter, closing)) }
    : { start: '', end: '' };
}
