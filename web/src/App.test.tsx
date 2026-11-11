import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from './App';

const room = { id: 'room-1', name: 'Атлас', location: '2 этаж', capacity: 8, description: null, equipment: ['Экран'], archived: false };
const employee = { id: 'actor', email: 'employee@example.test', roles: ['employee'] };
const booking = {
  id: 'b1', roomId: room.id, title: 'Планирование', description: 'Повестка', ownerId: employee.id,
  start: '2099-06-15T07:00:00Z', end: '2099-06-15T08:00:00Z', status: 'active', kind: 'booking',
};
const notification = { id: 'n1', type: 'booking_created', title: booking.title, readAt: null, createdAt: booking.start };

type Route = [string, unknown, number?];
function mockApi(routes: Route[]) {
  const requests: { path: string; headers: Headers; body: unknown }[] = [];
  const remaining = [...routes];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = `${init.method ?? 'GET'} ${url}`;
    const headers = new Headers(init.headers);
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ path, headers, body });
    const index = remaining.findIndex(([pattern]) => path.startsWith(pattern));
    if (index < 0) throw new Error(`Unexpected request ${path}`);
    const [, data, status = 200] = remaining.splice(index, 1)[0];
    return new Response(JSON.stringify(data), { status });
  }));
  return requests;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('shows the login link for a signed-out session and retries temporary auth failures', async () => {
  mockApi([['GET /api/auth/me', {}, 503], ['GET /api/auth/me', {}, 401]]);
  render(<App />);
  expect((await screen.findByRole('alert')).textContent).toContain('временно');
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  expect((await screen.findByRole('link', { name: 'Войти через SSO' })).getAttribute('href')).toBe('/api/auth/login');
});

test('offers logout to a signed-in user without an application role', async () => {
  const requests = mockApi([
    ['GET /api/auth/me', {}, 403], ['GET /api/auth/csrf', { csrfToken: 'session-proof' }],
    ['POST /api/auth/logout', { localLoggedOut: true, ssoStatus: 'unavailable' }],
  ]);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Выйти' }));
  expect(await screen.findByRole('link', { name: 'Войти через SSO' })).toBeTruthy();
  expect(requests.at(-1)?.headers.get('X-CSRF-Token')).toBe('session-proof');
});

test('sends availability filters in Moscow time and keeps admin actions hidden for an employee', async () => {
  const requests = mockApi([
    ['GET /api/auth/me', employee], ['GET /api/rooms?', [room]], ['GET /api/rooms?', []],
  ]);
  render(<App />);
  await screen.findByRole('heading', { name: room.name });
  expect(screen.queryByRole('button', { name: 'Управление' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'Атлас' } });
  fireEvent.change(screen.getByLabelText('Вместимость от'), { target: { value: '6' } });
  fireEvent.change(screen.getByLabelText('Оборудование'), { target: { value: 'Экран, Камера' } });
  fireEvent.change(screen.getByLabelText('Свободна с'), { target: { value: '2099-06-15T10:00' } });
  fireEvent.change(screen.getByLabelText('Свободна до'), { target: { value: '2099-06-15T11:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Найти комнаты' }));
  await screen.findByText('Комнаты не найдены');
  const params = new URLSearchParams(requests.at(-1)?.path.split('?')[1]);
  expect(Object.fromEntries(params)).toEqual({
    search: 'Атлас', minCapacity: '6', equipment: 'Экран,Камера',
    start: '2099-06-15T07:00:00.000Z', end: '2099-06-15T08:00:00.000Z',
  });
});

test('keeps the booking draft and key on conflict or outage, then changes the key for a changed request', async () => {
  const routes: Route[] = [
    ['GET /api/auth/me', employee], ['GET /api/rooms?', [room]], ['GET /api/rooms/room-1/availability', []],
    ['GET /api/rooms/room-1/availability', []], ['GET /api/rooms/room-1/availability', []],
  ];
  for (const status of [409, 503, 201]) {
    routes.push(['GET /api/auth/csrf', { csrfToken: 'proof' }], ['POST /api/bookings', booking, status]);
  }
  const requests = mockApi(routes);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Расписание комнаты Атлас' }));
  const title = screen.getByLabelText('Название встречи');
  fireEvent.change(title, { target: { value: 'Планирование' } });
  fireEvent.change(screen.getByLabelText('Начало'), { target: { value: '2099-06-15T10:00' } });
  fireEvent.change(screen.getByLabelText('Окончание'), { target: { value: '2099-06-15T11:00' } });
  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Забронировать' }));
  submit();
  await screen.findByText('Этот интервал уже занят. Выберите другое время.');
  expect((title as HTMLInputElement).value).toBe('Планирование');
  submit();
  await screen.findByText('Сервис временно недоступен. Попробуйте ещё раз.');
  expect((title as HTMLInputElement).value).toBe('Планирование');
  fireEvent.change(title, { target: { value: 'Другая встреча' } });
  submit();
  await screen.findByText('Бронирование создано.');
  expect((title as HTMLInputElement).value).toBe('');
  const writes = requests.filter(({ path }) => path === 'POST /api/bookings');
  expect(writes[0].headers.get('X-CSRF-Token')).toBe('proof');
  expect(writes[0].body).toMatchObject({ start: '2099-06-15T07:00:00.000Z', roomId: room.id });
  const keys = writes.map(({ headers }) => headers.get('Idempotency-Key'));
  expect(keys[0]).toBeTruthy();
  expect(keys[0]).toBe(keys[1]);
  expect(keys[2]).not.toBe(keys[1]);
});

test('shows busy time without displaying private booking fields', async () => {
  mockApi([
    ['GET /api/auth/me', employee], ['GET /api/rooms?', [room]],
    ['GET /api/rooms/room-1/availability', [{ ...booking, title: 'Чужая встреча' }]],
    ['GET /api/rooms/room-1/availability', [{ ...booking, title: 'Чужая встреча' }]],
  ]);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Расписание комнаты Атлас' }));
  fireEvent.change(screen.getByLabelText('День расписания'), { target: { value: '2099-06-15' } });
  await waitFor(() => expect(within(screen.getByRole('list', { name: 'Интервалы расписания' })).getByText('Занято')).toBeTruthy());
  expect(screen.queryByText('Чужая встреча')).toBeNull();
  expect(screen.getByText('10:00–11:00')).toBeTruthy();
});

test('marks a notification read only after the server accepts it', async () => {
  const requests = mockApi([
    ['GET /api/auth/me', employee], ['GET /api/rooms?', []], ['GET /api/notifications', [notification]],
    ['GET /api/auth/csrf', { csrfToken: 'proof' }], ['PATCH /api/notifications/n1/read', { ...notification, readAt: booking.start }],
  ]);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Уведомления' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Отметить прочитанным' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Отметить прочитанным' })).toBeNull());
  expect(requests.at(-1)?.path).toBe('PATCH /api/notifications/n1/read');
});

test('edits and cancels future bookings through the owner endpoints', async () => {
  const requests = mockApi([
    ['GET /api/auth/me', employee], ['GET /api/rooms?', [room]], ['GET /api/bookings', [booking]],
    ['GET /api/auth/csrf', { csrfToken: 'proof' }], ['PATCH /api/bookings/b1', { ...booking, title: 'Обновлено' }],
    ['GET /api/bookings', [{ ...booking, title: 'Обновлено' }]],
    ['GET /api/auth/csrf', { csrfToken: 'proof' }], ['POST /api/bookings/b1/cancel', { ...booking, status: 'cancelled' }],
    ['GET /api/bookings', [{ ...booking, title: 'Обновлено', status: 'cancelled' }]],
  ]);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Мои бронирования' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Изменить' }));
  fireEvent.change(screen.getByLabelText('Название встречи'), { target: { value: 'Обновлено' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
  await screen.findByRole('heading', { name: 'Обновлено' });
  fireEvent.click(screen.getByRole('button', { name: 'Отменить бронь' }));
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить отмену' }));
  await screen.findByText('Бронирование отменено.');
  fireEvent.click(screen.getByRole('button', { name: 'История' }));
  expect(await screen.findByText('Отменено')).toBeTruthy();
  expect(requests.find(({ path }) => path === 'PATCH /api/bookings/b1')?.body).toMatchObject({ title: 'Обновлено' });
});

test('shows maintenance conflicts with the interval and preserves the admin draft', async () => {
  const requests = mockApi([
    ['GET /api/auth/me', { ...employee, roles: ['admin'] }], ['GET /api/rooms?includeArchived=true', [room]],
    ['GET /api/rooms?', [room]], ['GET /api/admin/rooms/room-1/maintenance', []],
    ['GET /api/auth/csrf', { csrfToken: 'proof' }],
    ['POST /api/admin/rooms/room-1/maintenance', { conflicts: [booking] }, 409],
  ]);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Управление' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Обслуживание' }));
  fireEvent.change(screen.getByLabelText('Начало'), { target: { value: '2099-06-15T09:00' } });
  fireEvent.change(screen.getByLabelText('Окончание'), { target: { value: '2099-06-15T12:00' } });
  fireEvent.change(screen.getByLabelText('Причина обслуживания'), { target: { value: 'Замена экрана' } });
  fireEvent.click(screen.getByRole('button', { name: 'Заблокировать время' }));
  expect(await screen.findByText('Планирование')).toBeTruthy();
  expect((screen.getByLabelText('Причина обслуживания') as HTMLTextAreaElement).value).toBe('Замена экрана');
  expect(requests.at(-1)?.body).toMatchObject({ reason: 'Замена экрана', start: '2099-06-15T06:00:00.000Z' });
});

test('requires an admin reason before cancelling a booking', async () => {
  const requests = mockApi([
    ['GET /api/auth/me', { ...employee, roles: ['admin'] }], ['GET /api/rooms?includeArchived=true', [room]],
    ['GET /api/rooms?', [room]], ['GET /api/admin/bookings', [booking]],
    ['GET /api/auth/csrf', { csrfToken: 'proof' }], ['POST /api/admin/bookings/b1/cancel', { ...booking, status: 'cancelled' }],
    ['GET /api/admin/bookings', [{ ...booking, status: 'cancelled' }]],
  ]);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Управление' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Бронирования сотрудников' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Отменить бронь' }));
  const confirm = screen.getByRole('button', { name: 'Подтвердить отмену' });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Причина отмены'), { target: { value: 'Работы в офисе' } });
  fireEvent.click(confirm);
  await screen.findByText('Бронирование отменено.');
  expect(requests.find(({ path }) => path === 'POST /api/admin/bookings/b1/cancel')?.body).toEqual({ reason: 'Работы в офисе' });
});
