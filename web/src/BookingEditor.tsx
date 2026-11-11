import { useRef } from 'react';
import { ApiError, type Api, type Booking, type Room } from './api';
import { officeInput, parseRange } from './time';
import { Field, Problem, TimeFields, submit, useAction } from './ui';

export interface BookingDraft {
  roomId: string;
  title: string;
  description: string;
  start: string;
  end: string;
}

export function draftFor(booking: Booking): BookingDraft {
  return { roomId: booking.roomId, title: booking.title, description: booking.description ?? '',
    start: officeInput(booking.start), end: officeInput(booking.end) };
}

export function BookingEditor({ api, draft, onChange, onSuccess, onConflict, onClose, booking, rooms, roomName }: {
  api: Api;
  draft: BookingDraft;
  onChange: (draft: BookingDraft) => void;
  onSuccess: (booking: Booking) => void;
  onConflict?: () => void;
  onClose?: () => void;
  booking?: Booking;
  rooms?: Room[];
  roomName?: string;
}) {
  const action = useAction();
  const attempt = useRef<{ body: string; key: string }>(undefined);
  const change = (field: keyof BookingDraft, value: string) => {
    onChange({ ...draft, [field]: value });
  };

  async function save() {
    const title = draft.title.trim();
    if (!title) throw 'Введите название встречи.';
    const interval = parseRange(draft.start, draft.end, 'booking');
    const payload = { roomId: draft.roomId, title, description: draft.description.trim() || null, ...interval };
    let result: Booking;
    if (booking) {
      const original = draftFor(booking);
      const { start, end, ...details } = payload;
      const patch = { ...details, ...(draft.start !== original.start ? { start } : {}), ...(draft.end !== original.end ? { end } : {}) };
      result = await api.write<Booking>('/bookings/' + booking.id, 'PATCH', patch);
    } else {
      const body = JSON.stringify(payload);
      if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
      try {
        result = await api.write<Booking>('/bookings', 'POST', payload, attempt.current.key);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) onConflict?.();
        throw error;
      }
      attempt.current = undefined;
    }
    onSuccess(result);
  }

  return <form className="editor" aria-label={booking ? 'Изменить бронирование' : 'Новое бронирование'}
    onSubmit={submit(() => void action.run(save))}>
    <fieldset disabled={action.busy}>
      {rooms
        ? <Field label="Переговорная"><select required value={draft.roomId} onChange={(e) => change('roomId', e.target.value)}>
          {!rooms.some((room) => room.id === draft.roomId) && <option value={draft.roomId}>Текущая комната</option>}
          {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
        </select></Field>
        : roomName && <p className="form-context">{roomName}</p>}
      <Field label="Название встречи"><input required maxLength={120} value={draft.title} onChange={(e) => change('title', e.target.value)} /></Field>
      <TimeFields value={draft} change={change} />
      <Field label="Описание (необязательно)"><textarea maxLength={3000} rows={3} value={draft.description}
        onChange={(e) => change('description', e.target.value)} /></Field>
      <p className="help">Московское время · 08:00–20:00 · до 8 часов</p>
      <Problem error={action.error} conflict="Этот интервал уже занят. Выберите другое время." />
      <div className="actions">
        <button className="button primary" type="submit">{action.busy ? 'Сохраняем…' : booking ? 'Сохранить изменения' : 'Забронировать'}</button>
        {onClose && <button className="button secondary" type="button" onClick={onClose}>Закрыть</button>}
      </div>
    </fieldset>
  </form>;
}
