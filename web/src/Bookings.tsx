import { useState } from 'react';
import { CalendarDays, MapPin } from 'lucide-react';
import { type Api, type Booking, type Room } from './api';
import { BookingEditor, draftFor, type BookingDraft } from './BookingEditor';
import { displayRange } from './time';
import { Empty, Field, Loading, Problem, Status, submit, useAction, useResource } from './ui';

export const isFutureActive = (booking: Booking) => booking.status === 'active' && Date.parse(booking.start) > Date.now();

export function Bookings({ api, rooms, admin = false }: { api: Api; rooms: Room[]; admin?: boolean }) {
  const [showHistory, setShowHistory] = useState(false);
  const [edit, setEdit] = useState<{ booking: Booking; draft: BookingDraft } | null>(null);
  const [cancel, setCancel] = useState<Booking | null>(null);
  const [success, setSuccess] = useState('');
  const base = admin ? '/admin/bookings' : '/bookings';
  const bookings = useResource<Booking[]>(api, base);
  const byRoom = new Map(rooms.map((room) => [room.id, room]));
  const history = (booking: Booking) => booking.status === 'cancelled' || Date.parse(booking.end) <= Date.now();
  const filtered = bookings.data?.filter((booking) => history(booking) === showHistory);
  const sorted = showHistory ? filtered : filtered?.toReversed();
  const changeView = (value: boolean) => {
    setEdit(null);
    setCancel(null);
    setSuccess('');
    setShowHistory(value);
  };
  const saved = (notice: string) => {
    setEdit(null);
    setCancel(null);
    setSuccess(notice);
    bookings.reload();
  };

  return <section aria-labelledby="bookings-heading">
    {!admin && <div className="page-heading">
      <h1 id="bookings-heading">Мои бронирования</h1>
      <p>Планируйте встречи и управляйте своими бронированиями.</p>
    </div>}
    {admin && <h2 className="sr-only" id="bookings-heading">Бронирования сотрудников</h2>}
    <div className="switcher" aria-label="Период бронирований">
      <button type="button" aria-pressed={!showHistory} onClick={() => changeView(false)}>Предстоящие</button>
      <button type="button" aria-pressed={showHistory} onClick={() => changeView(true)}>История</button>
    </div>
    <Status>{success}</Status>
    {bookings.loading && <Loading />}
    <Problem error={bookings.error} retry={bookings.reload} />
    {sorted?.length === 0 && <Empty>{showHistory ? 'История бронирований пока пуста' : 'Предстоящих встреч пока нет'}</Empty>}
    <div className="item-stack">
      {sorted?.map((booking) => {
        const room = byRoom.get(booking.roomId);
        return <article key={booking.id} className="panel booking-item">
          <div className="item-main">
            <span className="item-icon"><CalendarDays aria-hidden="true" /></span>
            <div className="item-content">
              <h3>{booking.title}</h3>
              <p className="icon-line"><MapPin aria-hidden="true" /> {room?.name ?? 'Комната недоступна'}{room?.location ? ' · ' + room.location : ''}</p>
              <p>{displayRange(booking.start, booking.end)} · МСК</p>
              {booking.description && <p className="item-description">{booking.description}</p>}
              {admin && booking.ownerId && <p className="help owner-id">ID сотрудника {booking.ownerId}</p>}
              {booking.cancellationReason && <p className="help">Причина отмены — {booking.cancellationReason}</p>}
            </div>
            <span className={'pill ' + (booking.status === 'cancelled' ? 'cancelled' : showHistory ? 'complete' : 'free')}>
              {booking.status === 'cancelled' ? 'Отменено' : showHistory ? 'Завершено' : 'Подтверждено'}
            </span>
          </div>
          {isFutureActive(booking) && <div className="actions item-actions">
            {!admin && <button type="button" className="button secondary small" onClick={() => {
              setCancel(null); setSuccess(''); setEdit({ booking, draft: draftFor(booking) });
            }}>Изменить</button>}
            <button type="button" className="button danger small" onClick={() => {
              setEdit(null); setSuccess(''); setCancel(booking);
            }}>Отменить бронь</button>
          </div>}
          {edit?.booking.id === booking.id && <div className="inline-editor">
            <BookingEditor api={api} booking={booking} rooms={rooms} draft={edit.draft}
              onChange={(draft) => setEdit({ booking, draft })}
              onSuccess={() => saved('Бронирование обновлено.')} onClose={() => setEdit(null)} />
          </div>}
          {cancel?.id === booking.id && <div className="inline-editor">
            <CancelBooking api={api} path={base + '/' + booking.id + '/cancel'} admin={admin}
              onClose={() => setCancel(null)} onSuccess={() => saved('Бронирование отменено.')} />
          </div>}
        </article>;
      })}
    </div>
  </section>;
}

function CancelBooking({ api, path, admin, onClose, onSuccess }: {
  api: Api; path: string; admin: boolean; onClose: () => void; onSuccess: () => void;
}) {
  const [reason, setReason] = useState('');
  const action = useAction();
  return <form aria-label="Подтверждение отмены бронирования" onSubmit={submit(() => void action.run(async () => {
    if (admin && !reason.trim()) throw 'Укажите причину отмены.';
    await api.write(path, 'POST', admin ? { reason: reason.trim() } : undefined);
    onSuccess();
  }))}>
    <fieldset disabled={action.busy}>
      <h4>Отменить бронирование?</h4>
      <p className="help">Комната станет доступна для других встреч.</p>
      {admin && <Field label="Причина отмены"><textarea rows={2} autoFocus required maxLength={500}
        value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      <Problem error={action.error} />
      <div className="actions">
        <button type="submit" className="button danger-solid" disabled={admin && !reason.trim()}>Подтвердить отмену</button>
        <button type="button" className="button secondary" autoFocus={!admin} onClick={onClose}>Оставить бронь</button>
      </div>
    </fieldset>
  </form>;
}
