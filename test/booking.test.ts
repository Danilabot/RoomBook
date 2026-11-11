import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { User } from '../src/auth/user.entity.js';
import { databaseOptions } from '../src/database/options.js';
import { ReminderService } from '../src/notifications/reminder.service.js';

const owner = randomUUID();
const other = randomUUID();
const admin = randomUUID();
const actors = new Map([
  ['owner', { id: owner, roles: ['employee'] }],
  ['other', { id: other, roles: ['employee'] }],
  ['admin', { id: admin, roles: ['admin'] }],
  ['unauthorized-role', { id: randomUUID(), roles: [] }],
]);
const connectionUrl = process.env.TEST_DATABASE_URL;
assert.ok(connectionUrl, 'Set TEST_DATABASE_URL to a disposable PostgreSQL database');
const schema = 'test_' + randomUUID().replaceAll('-', '');

let app: INestApplication;
let db: DataSource;
let bootstrapDb: DataSource;
let roomId: string;

function at(day: number, time: string): string {
  const date = new Date(Date.now() + day * 86_400_000).toISOString().slice(0, 10);
  return date + 'T' + time + ':00+03:00';
}

function booking(day: number, start = '09:00', end = '10:00') {
  return { roomId, start: at(day, start), end: at(day, end), title: 'Private title', description: 'Private details' };
}

const api = () => request(app.getHttpServer());
const create = (body: ReturnType<typeof booking>, key = randomUUID().toString(), actor = 'owner') =>
  api().post('/api/bookings').set('Authorization', actor).set('Idempotency-Key', key).send(body);

before(async () => {
  bootstrapDb = await new DataSource({ type: 'postgres', url: connectionUrl }).initialize();
  await bootstrapDb.query('CREATE SCHEMA "' + schema + '"');
  process.env.DATABASE_URL = connectionUrl;
  process.env.DATABASE_SCHEMA = schema;
  db = await new DataSource(databaseOptions()).initialize();
  const migrations = await db.runMigrations();
  assert.ok(migrations.some(({ name }) => name === 'CreateBookingSchema1760000000000'));
  assert.equal((await db.runMigrations()).length, 0);
  await db.undoLastMigration();
  assert.equal((await db.runMigrations()).length, 1);

  await db.getRepository(User).insert([...actors.values()].map(({ id }, index) =>
    ({ id, oidcIssuer: 'https://issuer.example/realm', oidcSubject: 'subject-' + index, name: 'Test user ' + index, email: 'user' + index + '@example.test' })));
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  app.use((req: { headers: { authorization?: string }; user?: unknown }, _res: unknown, next: () => void) => {
    req.user = actors.get(req.headers.authorization ?? '');
    next();
  });
  configureApp(app);
  await app.init();
  const room = await api().post('/api/rooms').set('Authorization', 'admin')
    .send({ name: 'Atlas', location: 'Floor 3', capacity: 10, equipment: ['Projector', 'Whiteboard'] }).expect(201);
  roomId = room.body.id;
});

after(async () => {
  if (app) await app.close();
  if (db?.isInitialized) await db.destroy();
  if (bootstrapDb?.isInitialized) {
    await bootstrapDb.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    await bootstrapDb.destroy();
  }
});

test('lists and filters rooms by capacity, text and equipment', async () => {
  await api().get('/api/rooms').expect(401);
  await api().post('/api/bookings').send({}).expect(401);
  await api().post('/api/bookings').set('Authorization', 'unauthorized-role').send({}).expect(403);
  await api().post('/api/rooms').set('Authorization', 'owner').send({}).expect(403);
  const match = await api().get('/api/rooms?search=atl&minCapacity=9&equipment=projector,whiteboard')
    .set('Authorization', 'owner').expect(200);
  assert.deepEqual(match.body.map(({ id }: { id: string }) => id), [roomId]);
  const noMatch = await api().get('/api/rooms?minCapacity=12').set('Authorization', 'owner').expect(200);
  assert.deepEqual(noMatch.body, []);
});

test('uses half-open Moscow hours and rejects excessive, past or ambiguous intervals', async () => {
  await create(booking(2, '07:59', '09:00')).expect(400);
  await create(booking(2, '19:00', '20:01')).expect(400);
  await create(booking(2, '08:00', '16:01')).expect(400);
  await create(booking(2, '10:00', '10:00')).expect(400);
  await create(booking(-2)).expect(400);
  await create({ ...booking(2), start: at(2, '09:00').slice(0, -6) }).expect(400);
  await create(booking(2, '08:00', '16:00')).expect(201);
  await create(booking(2, '16:00', '20:00')).expect(201);
});

test('rejects one simultaneous overlap and enforces the constraint for direct database writes', async () => {
  const responses = await Promise.all([create(booking(3)), create(booking(3), randomUUID(), 'other')]);
  assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
  await assert.rejects(db.query(`INSERT INTO "${schema}".occupancies (room_id, owner_id, kind, title, starts_at, ends_at)
    VALUES ($1,$2,'booking','Direct overlap',$3,$4)`, [roomId, owner, at(3, '09:00'), at(3, '10:00')]), { code: '23P01' });
});

test('replays the same outcome for parallel idempotent requests and rejects changed payloads', async () => {
  const key = randomUUID();
  const first = booking(4);
  const equivalent = { ...first, start: new Date(first.start).toISOString(), title: '  Private title ' };
  const [a, b] = await Promise.all([create(first, key).expect(201), create(equivalent, key).expect(201)]);
  assert.deepEqual(a.body, b.body);
  await create({ ...first, title: 'Changed' }, key).expect(409);
  await create(booking(4, '11:00', '12:00'), key, 'other').expect(201);
  await api().post('/api/bookings/' + a.body.id + '/cancel').set('Authorization', 'owner').expect(200);
  const replay = await create(first, key).expect(201);
  assert.deepEqual(replay.body, a.body);
});

test('preserves calendar privacy, enforces ownership and retains cancellation history', async () => {
  const { body } = await create(booking(5)).expect(201);
  const calendar = await api().get('/api/rooms/' + roomId + '/availability')
    .set('Authorization', 'other').query({ start: at(5, '08:00'), end: at(5, '12:00') }).expect(200);
  assert.equal(calendar.body.length, 1);
  assert.deepEqual(Object.keys(calendar.body[0]).sort(), ['end', 'kind', 'start']);
  await api().get('/api/bookings/' + body.id).set('Authorization', 'other').expect(404);
  await api().patch('/api/bookings/' + body.id).set('Authorization', 'other').send({ title: 'Other' }).expect(404);
  const update = await api().patch('/api/bookings/' + body.id).set('Authorization', 'owner')
    .send({ title: 'Updated', end: at(5, '11:00') }).expect(200);
  assert.equal(update.body.title, 'Updated');
  await api().post('/api/admin/bookings/' + body.id + '/cancel').set('Authorization', 'admin').send({}).expect(400);
  await api().post('/api/admin/bookings/' + body.id + '/cancel').set('Authorization', 'other')
    .send({ reason: 'Reserved for audit' }).expect(403);
  await api().post('/api/admin/bookings/' + body.id + '/cancel').set('Authorization', 'admin')
    .send({ reason: 'Reserved for audit' }).expect(200);
  const history = await api().get('/api/bookings').set('Authorization', 'owner').expect(200);
  const cancelled = history.body.find(({ id }: { id: string }) => id === body.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancellationReason, 'Reserved for audit');
  await create(booking(5)).expect(201);
});

test('reports maintenance conflicts to admins and reserves time only after the conflict clears', async () => {
  const { body } = await create(booking(6)).expect(201);
  const path = '/api/admin/rooms/' + roomId + '/maintenance';
  const window = { start: at(6, '08:00'), end: at(6, '14:00'), reason: 'Electrical work' };
  const conflict = await api().post(path).set('Authorization', 'admin').send(window).expect(409);
  assert.equal(conflict.body.conflicts[0].id, body.id);
  await api().post('/api/bookings/' + body.id + '/cancel').set('Authorization', 'owner').expect(200);
  const maintenance = await api().post(path).set('Authorization', 'admin').send(window).expect(201);
  const employeeConflict = await create(booking(6)).expect(409);
  assert.equal(employeeConflict.body.conflicts, undefined);
  await api().delete('/api/admin/maintenance/' + maintenance.body.id).set('Authorization', 'admin').expect(200);
  await create(booking(6)).expect(201);
});

test('atomically retains lifecycle events and delivers a reminder once across workers', async () => {
  const { body } = await create(booking(7)).expect(201);
  const inbox = await api().get('/api/notifications').set('Authorization', 'owner').expect(200);
  const confirmation = inbox.body.find((item: { bookingId: string; type: string }) =>
    item.bookingId === body.id && item.type === 'booking_created');
  assert.ok(confirmation);
  await api().patch('/api/notifications/' + confirmation.id + '/read').set('Authorization', 'other').expect(404);
  const read = await api().patch('/api/notifications/' + confirmation.id + '/read').set('Authorization', 'owner').expect(200);
  assert.ok(read.body.readAt);
  await db.query(`UPDATE "${schema}".reminder_jobs SET due_at = now() WHERE booking_id = $1`, [body.id]);
  const service = app.get(ReminderService);
  const counts = await Promise.all([service.deliverDue(), service.deliverDue()]);
  assert.equal(counts[0] + counts[1], 1);
  const afterDelivery = await api().get('/api/notifications').set('Authorization', 'owner').expect(200);
  assert.equal(afterDelivery.body.filter((item: { bookingId: string; type: string }) =>
    item.bookingId === body.id && item.type === 'booking_reminder').length, 1);
  const cancelled = await create(booking(8)).expect(201);
  await db.query(`UPDATE "${schema}".reminder_jobs SET due_at = now() WHERE booking_id = $1`, [cancelled.body.id]);
  await api().post('/api/bookings/' + cancelled.body.id + '/cancel').set('Authorization', 'owner').expect(200);
  assert.equal(await service.deliverDue(), 0);
});

test('archives rooms without removing existing bookings or accepting new ones', async () => {
  const archiveRoom = await api().post('/api/rooms').set('Authorization', 'admin')
    .send({ name: 'Archive me', location: 'Floor 3', capacity: 3, equipment: [] }).expect(201);
  const data = { ...booking(9), roomId: archiveRoom.body.id };
  const { body } = await create(data).expect(201);
  await api().delete('/api/rooms/' + data.roomId).set('Authorization', 'admin').expect(200);
  await api().get('/api/rooms/' + data.roomId).set('Authorization', 'owner').expect(404);
  await api().get('/api/bookings/' + body.id).set('Authorization', 'owner').expect(200);
  await create({ ...data, start: at(9, '11:00'), end: at(9, '12:00') }).expect(409);
  const rooms = await api().get('/api/rooms?includeArchived=true').set('Authorization', 'admin').expect(200);
  assert.ok(rooms.body.some((room: { id: string; archived: boolean }) => room.id === data.roomId && room.archived));
});

test('retries reminder delivery after a database failure without losing the booking', async () => {
  const { body } = await create(booking(10)).expect(201);
  await db.query(`UPDATE "${schema}".reminder_jobs SET due_at = now() WHERE booking_id = $1`, [body.id]);
  await db.query(`ALTER TABLE "${schema}".notifications ADD CONSTRAINT reject_new_reminders
    CHECK (type <> 'booking_reminder') NOT VALID`);
  const reminders = app.get(ReminderService);
  try {
    await assert.rejects(reminders.deliverDue(), { code: '23514' });
    await api().get('/api/bookings/' + body.id).set('Authorization', 'owner').expect(200);
  } finally {
    await db.query(`ALTER TABLE "${schema}".notifications DROP CONSTRAINT reject_new_reminders`);
  }
  assert.equal(await reminders.deliverDue(), 1);
  assert.equal(await reminders.deliverDue(), 0);
});
