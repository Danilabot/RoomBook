import { useState } from 'react';
import { ArrowLeft, DoorOpen, Plus } from 'lucide-react';
import { ApiError, type Api, type Booking, type Room } from './api';
import { Bookings, isFutureActive } from './Bookings';
import { displayRange, parseRange } from './time';
import { Empty, Field, Loading, Problem, Status, TimeFields, seatCount, submit, useAction, useResource } from './ui';

export function Admin({ api, onRoomsChange }: { api: Api; onRoomsChange: () => void }) {
  const [view, setView] = useState<'rooms' | 'bookings'>('rooms');
  const [editRoom, setEditRoom] = useState<Room | 'new' | null>(null);
  const [maintenanceRoom, setMaintenanceRoom] = useState<Room | null>(null);
  const [success, setSuccess] = useState('');
  const rooms = useResource<Room[]>(api, '/rooms?includeArchived=true');
  const updated = (message: string) => {
    setEditRoom(null);
    setSuccess(message);
    rooms.reload();
    onRoomsChange();
  };
  const switchView = (next: typeof view) => {
    setView(next);
    setEditRoom(null);
    setMaintenanceRoom(null);
    setSuccess('');
  };
  return <>
    <div className="page-heading">
      <h1>Управление</h1>
      <p>Настраивайте каталог, планируйте обслуживание и управляйте встречами.</p>
    </div>
    <div className="switcher" aria-label="Управление">
      <button type="button" aria-pressed={view === 'rooms'} onClick={() => switchView('rooms')}>Комнаты</button>
      <button type="button" aria-pressed={view === 'bookings'} onClick={() => switchView('bookings')}>Бронирования сотрудников</button>
    </div>
    {view === 'bookings'
      ? <Bookings api={api} admin rooms={rooms.data ?? []} />
      : maintenanceRoom
        ? <Maintenance api={api} room={maintenanceRoom} onClose={() => setMaintenanceRoom(null)} />
        : <section aria-labelledby="manage-rooms-heading">
          <div className="section-heading admin-heading"><h2 id="manage-rooms-heading">Каталог комнат</h2>
            <button type="button" className="button primary" onClick={() => { setEditRoom('new'); setSuccess(''); }}><Plus aria-hidden="true" /> Новая комната</button>
          </div>
          <Status>{success}</Status>
          {editRoom && <div className="panel inline-panel">
            <RoomEditor key={editRoom === 'new' ? 'new' : editRoom.id} api={api} room={editRoom === 'new' ? undefined : editRoom}
              onSuccess={updated} onClose={() => setEditRoom(null)} />
          </div>}
          {rooms.loading && <Loading />}
          <Problem error={rooms.error} retry={rooms.reload} />
          {rooms.data?.length === 0 && <Empty>В каталоге пока нет комнат</Empty>}
          <div className="item-stack">{rooms.data?.map((room) => <ManagedRoom key={room.id} api={api} room={room}
            onEdit={() => { setEditRoom(room); setSuccess(''); }}
            onMaintenance={() => { setMaintenanceRoom(room); setEditRoom(null); setSuccess(''); }}
            onArchive={updated} />)}</div>
        </section>}
  </>;
}

function ManagedRoom({ api, room, onEdit, onMaintenance, onArchive }: {
  api: Api; room: Room; onEdit: () => void; onMaintenance: () => void; onArchive: (message: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const action = useAction();
  return <article className="panel">
    <div className="item-main">
      <span className="item-icon"><DoorOpen aria-hidden="true" /></span>
      <div className="item-content"><h3>{room.name}</h3><p>{room.location} · {seatCount(room.capacity)}</p></div>
      <span className={'pill ' + (room.archived ? 'complete' : 'free')}>{room.archived ? 'Архив' : 'Активна'}</span>
    </div>
    <Problem error={action.error} conflict="Не удалось изменить статус комнаты. Проверьте её расписание." />
    {confirm && <p className="help">Скрыть комнату из каталога? История бронирований сохранится.</p>}
    <div className="actions item-actions">
      {!confirm && <><button type="button" className="button secondary small" onClick={onEdit}>Редактировать</button>
        <button type="button" className="button secondary small" onClick={onMaintenance}>Обслуживание</button></>}
      {room.archived
        ? <button type="button" className="button secondary small" disabled={action.busy} onClick={() => void action.run(async () => {
          await api.write('/rooms/' + room.id, 'PATCH', { archived: false });
          onArchive('Комната возвращена в каталог.');
        })}>Восстановить</button>
        : confirm
          ? <>
            <button type="button" className="button danger-solid small" disabled={action.busy} onClick={() => void action.run(async () => {
              await api.write('/rooms/' + room.id, 'DELETE');
              onArchive('Комната перемещена в архив.');
            })}>Подтвердить архивацию</button>
            <button type="button" className="button secondary small" disabled={action.busy} onClick={() => {
              setConfirm(false); action.clear();
            }}>Оставить активной</button>
          </>
          : <button type="button" className="button danger small" onClick={() => setConfirm(true)}>В архив</button>}
    </div>
  </article>;
}

function RoomEditor({ api, room, onSuccess, onClose }: {
  api: Api; room?: Room; onSuccess: (message: string) => void; onClose: () => void;
}) {
  const [fields, setFields] = useState({
    name: room?.name ?? '', location: room?.location ?? '', capacity: room ? String(room.capacity) : '',
    description: room?.description ?? '', equipment: room?.equipment.join('\n') ?? '',
  });
  const action = useAction();
  const change = (field: keyof typeof fields, value: string) => setFields({ ...fields, [field]: value });
  return <form aria-label={room ? 'Редактировать комнату' : 'Создать комнату'} onSubmit={submit(() => void action.run(async () => {
    const name = fields.name.trim();
    const location = fields.location.trim();
    const capacity = Number(fields.capacity);
    const equipment = fields.equipment.split('\n').map((item) => item.trim()).filter(Boolean);
    if (!name || !location || !Number.isInteger(capacity) || capacity < 1 || capacity > 10_000) throw 'Укажите название, расположение и вместимость.';
    if (equipment.length > 50 || equipment.some((item) => item.length > 80)) {
      throw 'Укажите до 50 позиций оборудования длиной до 80 символов каждая.';
    }
    await api.write(room ? '/rooms/' + room.id : '/rooms', room ? 'PATCH' : 'POST', {
      name, location, capacity, description: fields.description.trim() || null, equipment,
    });
    onSuccess(room ? 'Комната обновлена.' : 'Комната добавлена.');
  }))}>
    <fieldset disabled={action.busy}>
      <h3>{room ? 'Редактировать комнату' : 'Новая комната'}</h3>
      <div className="field-row">
        <Field label="Название комнаты"><input required autoFocus maxLength={120} value={fields.name} onChange={(e) => change('name', e.target.value)} /></Field>
        <Field label="Расположение"><input required maxLength={120} value={fields.location} onChange={(e) => change('location', e.target.value)} /></Field>
      </div>
      <Field label="Вместимость"><input type="number" required min={1} max={10000} value={fields.capacity} onChange={(e) => change('capacity', e.target.value)} /></Field>
      <Field label="Описание (необязательно)"><textarea rows={2} maxLength={3000} value={fields.description} onChange={(e) => change('description', e.target.value)} /></Field>
      <Field label="Оборудование (каждая позиция с новой строки)"><textarea rows={3} value={fields.equipment} onChange={(e) => change('equipment', e.target.value)} /></Field>
      <Problem error={action.error} />
      <div className="actions">
        <button type="submit" className="button primary">{action.busy ? 'Сохраняем…' : 'Сохранить комнату'}</button>
        <button type="button" className="button secondary" onClick={onClose}>Закрыть</button>
      </div>
    </fieldset>
  </form>;
}

function Maintenance({ api, room, onClose }: { api: Api; room: Room; onClose: () => void }) {
  const [fields, setFields] = useState({ start: '', end: '', reason: '' });
  const [success, setSuccess] = useState('');
  const path = '/admin/rooms/' + room.id + '/maintenance';
  const windows = useResource<Booking[]>(api, path);
  const action = useAction();
  const conflicts = action.error instanceof ApiError ? action.error.conflicts : [];
  const saved = (message: string) => { setSuccess(message); windows.reload(); };
  return <>
    <button type="button" className="text-button back-button" autoFocus onClick={onClose}><ArrowLeft aria-hidden="true" /> К управлению комнатами</button>
    <div className="section-heading admin-heading"><h2>Обслуживание · {room.name}</h2></div>
    <Status>{success}</Status>
    {!room.archived && <form className="panel inline-panel" aria-label="Добавить период обслуживания" onSubmit={submit(() => void action.run(async () => {
      setSuccess('');
      const reason = fields.reason.trim();
      if (!reason) throw 'Укажите причину обслуживания.';
      await api.write(path, 'POST', { ...parseRange(fields.start, fields.end, 'maintenance'), reason });
      setFields({ start: '', end: '', reason: '' });
      saved('Интервал обслуживания добавлен.');
    }))}>
      <fieldset disabled={action.busy}>
        <h3>Новый период обслуживания</h3>
        <TimeFields value={fields} change={(part, value) => setFields({ ...fields, [part]: value })} />
        <Field label="Причина обслуживания"><textarea rows={2} required maxLength={500} value={fields.reason}
          onChange={(e) => setFields({ ...fields, reason: e.target.value })} /></Field>
        <p className="help">Время указывается по Москве.</p>
        <Problem error={action.error} conflict="Интервал пересекается с существующими бронированиями или обслуживанием." />
        {conflicts.length > 0 && <ul className="conflicts" aria-label="Пересекающиеся интервалы">
          {conflicts.map((item) => <li key={item.id}><strong>{item.title}</strong><span>{displayRange(item.start, item.end)} · МСК</span></li>)}
        </ul>}
        <button type="submit" className="button primary">{action.busy ? 'Сохраняем…' : 'Заблокировать время'}</button>
      </fieldset>
    </form>}
    {windows.loading && <Loading />}
    <Problem error={windows.error} retry={windows.reload} />
    {windows.data?.length === 0 && <Empty>Интервалов обслуживания пока нет</Empty>}
    <div className="item-stack">{windows.data?.map((window) => <MaintenanceItem key={window.id} api={api} window={window}
      onCancel={() => saved('Обслуживание отменено.')} />)}</div>
  </>;
}

function MaintenanceItem({ api, window, onCancel }: { api: Api; window: Booking; onCancel: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const action = useAction();
  return <article className="panel">
    <div className="item-main">
      <div className="item-content"><h3>{window.title}</h3><p>{displayRange(window.start, window.end)} · МСК</p></div>
      <span className={'pill ' + (window.status === 'cancelled' ? 'cancelled' : 'maintenance')}>
        {window.status === 'cancelled' ? 'Отменено' : Date.parse(window.end) <= Date.now() ? 'Завершено' : 'Заблокировано'}
      </span>
    </div>
    <Problem error={action.error} />
    {isFutureActive(window) && <div className="actions item-actions">{confirm
      ? <>
        <button type="button" className="button danger-solid small" disabled={action.busy} onClick={() => void action.run(async () => {
          await api.write('/admin/maintenance/' + window.id, 'DELETE');
          onCancel();
        })}>Подтвердить отмену</button>
        <button type="button" className="button secondary small" disabled={action.busy} onClick={() => {
          setConfirm(false); action.clear();
        }}>Оставить период</button>
      </>
      : <button type="button" className="button danger small" onClick={() => setConfirm(true)}>Отменить обслуживание</button>}</div>}
  </article>;
}
