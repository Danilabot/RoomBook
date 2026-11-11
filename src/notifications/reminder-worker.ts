import { setTimeout as wait } from 'node:timers/promises';
import database from '../database/data-source.js';
import { ReminderService } from './reminder.service.js';

const shutdown = new AbortController();
process.on('SIGINT', () => shutdown.abort());
process.on('SIGTERM', () => shutdown.abort());

await database.initialize();
try {
  const reminders = new ReminderService(database);
  while (!shutdown.signal.aborted) {
    try {
      await reminders.deliverDue();
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.error('Reminder delivery failed (%s). The next cycle will retry pending jobs.', errorName);
    }
    try {
      await wait(15_000, undefined, { signal: shutdown.signal });
    } catch (error) {
      if (!shutdown.signal.aborted) throw error;
    }
  }
} finally {
  await database.destroy();
}
