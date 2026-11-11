import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Clock3, DoorOpen, MapPin, Search, Users } from 'lucide-react';
import { type Api, type Interval, type Room } from './api';
import { BookingEditor, type BookingDraft } from './BookingEditor';
import { dayTitle, nextSlot, officeClock, officeDay, officeInput, officeInstant, parseRange, schedule, stepDay } from './time';
import { Empty, Field, Loading, Problem, Status, seatCount, submit, useResource } from './ui';

const initialFilters = { search: '', capacity: '', equipment: '', start: '', end: '' };

export function Catalog({ api, rooms }: { api: Api; rooms: ReturnType<typeof useResource<Room[]>> }) {
  const [filters, setFilters] = useState(initialFilters);
  const [query, setQuery] = useState('');
  const [filterError, setFilterError] = useState<unknown>();
  const [selection, setSelection] = useState<Room | null>(null);
  const [selectedStart, setSelectedStart] = useState('');
  const [selectedEnd, setSelectedEnd] = useState('');
  const lastCard = useRef<HTMLButtonElement>(null);
  const filtered = useResource<Room[]>(api, query ? '/rooms?' + query : null);
  const results = query ? filtered : rooms;
  const change = (field: keyof typeof filters, value: string) => setFilters({ ...filters, [field]: value });

  function applyFilters() {
    setFilterError(undefined);
    try {
      const params = new URLSearchParams();
      if (filters.search.trim()) params.set('search', filters.search.trim());
      if (filters.capacity) params.set('minCapacity', filters.capacity);
      const equipment = filters.equipment.split(',').map((item) => item.trim()).filter(Boolean);
      if (equipment.length) params.set('equipment', equipment.join(','));
      if (filters.start || filters.end) {
        const interval = parseRange(filters.start, filters.end, 'filter');
        params.set('start', interval.start);
        params.set('end', interval.end);
      }
      if (params.toString() === query) results.reload();
      setQuery(params.toString());
    } catch (error) {
      setFilterError(error);
    }
  }

  function clearFilters() {
    setFilters(initialFilters);
    setQuery('');
    setFilterError(undefined);
  }

  function select(room: Room, button: HTMLButtonElement) {
    const params = new URLSearchParams(query);
    const start = params.get('start');
    const end = params.get('end');
    setSelectedStart(start ? officeInput(start) : '');
    setSelectedEnd(end ? officeInput(end) : '');
    lastCard.current = button;
    setSelection(room);
  }

  return <>
    <div hidden={!!selection}>
      <section className="hero" aria-labelledby="catalog-title">
        <div className="hero-content">
          <div className="hero-meta"><Clock3 aria-hidden="true" /> Московское время</div>
          <h1 id="catalog-title">Переговорные</h1>
          <p>Найдите комнату для встречи и забронируйте удобное время.</p>
        </div>
        <div className="hero-art" aria-hidden="true"><div /><div /><div /></div>
      </section>
      <div className="catalog-layout">
        <form className="panel filter-panel" aria-label="Фильтры переговорных" onSubmit={submit(applyFilters)}>
          <div className="section-heading"><h2>Фильтры</h2><button type="button" className="text-button" onClick={clearFilters}>Сбросить</button></div>
          <Field label="Поиск"><div className="input-icon"><Search aria-hidden="true" /><input type="search" maxLength={120}
            placeholder="Комната, этаж" value={filters.search} onChange={(e) => change('search', e.target.value)} /></div></Field>
          <Field label="Вместимость от"><input type="number" min={1} max={10000} placeholder="Мест"
            value={filters.capacity} onChange={(e) => change('capacity', e.target.value)} /></Field>
          <Field label="Оборудование"><input maxLength={4000} placeholder="Экран, камера"
            value={filters.equipment} onChange={(e) => change('equipment', e.target.value)} /></Field>
          <div className="filter-period">
            <h3>Свободный интервал</h3>
            <Field label="Свободна с"><input type="datetime-local" value={filters.start} onChange={(e) => change('start', e.target.value)} /></Field>
            <Field label="Свободна до"><input type="datetime-local" value={filters.end} onChange={(e) => change('end', e.target.value)} /></Field>
          </div>
          <Problem error={filterError} />
          <button className="button primary" type="submit"><Search aria-hidden="true" /> Найти комнаты</button>
        </form>
        <section aria-labelledby="results-title">
          <div className="section-heading result-heading">
            <h2 id="results-title">Каталог комнат</h2>
            {results.data && <span className="result-count" role="status">Найдено: {results.data.length}</span>}
          </div>
          {results.loading && <Loading />}
          <Problem error={results.error} retry={results.reload} />
          {results.data?.length === 0 && <Empty>{query ? 'Комнаты не найдены' : 'В каталоге пока нет комнат'}</Empty>}
          <div className="room-grid">
            {results.data?.map((room, index) => <article className="room-card" key={room.id}>
              <div className={'room-card-top tone-' + (index % 3)}>
                <span className="room-icon"><DoorOpen aria-hidden="true" /></span>
                <span className="capacity"><Users aria-hidden="true" /> {seatCount(room.capacity)}</span>
              </div>
              <div className="room-card-body">
                <h3>{room.name}</h3>
                <p className="muted icon-line"><MapPin aria-hidden="true" /> {room.location}</p>
                {room.description && <p className="room-description">{room.description}</p>}
                {room.equipment.length > 0 && <ul className="tags" aria-label="Оснащение">{room.equipment.map((item) => <li key={item}>{item}</li>)}</ul>}
                <button className="button secondary room-action" type="button" aria-label={'Расписание комнаты ' + room.name}
                  onClick={(event) => select(room, event.currentTarget)}>Расписание <ArrowRight aria-hidden="true" /></button>
              </div>
            </article>)}
          </div>
        </section>
      </div>
    </div>
    {selection && <RoomDetail api={api} room={selection} initialStart={selectedStart} initialEnd={selectedEnd} onClose={() => {
      setSelection(null);
      requestAnimationFrame(() => lastCard.current?.focus());
    }} />}
  </>;
}

const segmentLabels = { free: 'Свободно', booking: 'Занято', maintenance: 'Обслуживание' };

function RoomDetail({ api, room, initialStart, initialEnd, onClose }: {
  api: Api; room: Room; initialStart: string; initialEnd: string; onClose: () => void;
}) {
  const defaultDay = nextSlot(officeDay()).start ? officeDay() : stepDay(officeDay(), 1);
  const [day, setDay] = useState(initialStart.slice(0, 10) || defaultDay);
  const [draft, setDraft] = useState<BookingDraft>({
    roomId: room.id, title: '', description: '',
    ...(initialStart ? { start: initialStart, end: initialEnd } : nextSlot(defaultDay)),
  });
  const [success, setSuccess] = useState('');
  const from = officeInstant(day + 'T08:00');
  const to = officeInstant(day + 'T20:00');
  const path = from && to ? '/rooms/' + room.id + '/availability?' + new URLSearchParams({ start: from, end: to }) : null;
  const availability = useResource<Interval[]>(api, path);
  const segments = availability.data ? schedule(day, availability.data) : [];
  const displayDate = (next: string) => {
    if (!officeInstant(next + 'T08:00')) return;
    setDay(next);
    setDraft({ ...draft, ...nextSlot(next) });
    setSuccess('');
  };
  const selectSlot = (start: number, end: number) => {
    const minute = 60_000;
    const opening = Math.max(Math.ceil(start / minute), Math.ceil((Date.now() + 1) / minute)) * minute;
    const closing = Math.min(opening + 60 * minute, Math.floor(end / minute) * minute);
    if (opening < closing) {
      setDraft({ ...draft, start: officeInput(opening), end: officeInput(closing) });
      setSuccess('');
    }
  };

  return <>
    <button type="button" className="text-button back-button" autoFocus onClick={onClose}><ArrowLeft aria-hidden="true" /> К каталогу</button>
    <div className="page-heading detail-heading">
      <h1>{room.name}</h1>
      <p className="icon-line"><MapPin aria-hidden="true" /> {room.location} <span className="divider-dot">·</span> <Users aria-hidden="true" /> {seatCount(room.capacity)}</p>
      {room.description && <p>{room.description}</p>}
      {room.equipment.length > 0 && <ul className="tags" aria-label="Оснащение">{room.equipment.map((item) => <li key={item}>{item}</li>)}</ul>}
    </div>
    <div className="detail-layout">
      <section className="panel" aria-labelledby="schedule-heading">
        <div className="section-heading"><h2 id="schedule-heading"><CalendarDays aria-hidden="true" /> Расписание</h2></div>
        <div className="day-controls">
          <button type="button" className="button secondary icon-button" aria-label="Предыдущий день" onClick={() => displayDate(stepDay(day, -1))}><ChevronLeft aria-hidden="true" /></button>
          <Field label="День расписания"><input type="date" value={day} onChange={(e) => displayDate(e.target.value)} /></Field>
          <button type="button" className="button secondary icon-button" aria-label="Следующий день" onClick={() => displayDate(stepDay(day, 1))}><ChevronRight aria-hidden="true" /></button>
        </div>
        <p className="help schedule-date">{dayTitle(day)} · Московское время</p>
        {availability.loading && <Loading />}
        <Problem error={availability.error} retry={availability.reload} />
        {availability.data && <>
          <div className="timeline" aria-hidden="true">{segments.map(({ start, end, kind }) => <span key={start} className={kind} style={{ flexGrow: end - start }} />)}</div>
          <div className="timeline-scale" aria-hidden="true"><span>08:00</span><span>11:00</span><span>14:00</span><span>17:00</span><span>20:00</span></div>
          <ul className="intervals" aria-label="Интервалы расписания">
            {segments.map(({ start, end, kind }) => <li key={start}>
              <span className="interval-time">{officeClock(start)}–{officeClock(end)}</span>
              <span className={'pill ' + kind}>{segmentLabels[kind]}</span>
              {kind === 'free' && Math.floor(end / 60_000) > Math.max(Math.ceil(start / 60_000), Math.ceil((Date.now() + 1) / 60_000))
                && <button type="button" className="text-button" aria-label={'Выбрать время ' + officeClock(start) + '–' + officeClock(end)}
                  onClick={() => selectSlot(start, end)}>Выбрать</button>}
            </li>)}
          </ul>
        </>}
      </section>
      <section className="panel" aria-labelledby="booking-heading">
        <div className="section-heading"><h2 id="booking-heading">Новое бронирование</h2></div>
        <Status>{success}</Status>
        <BookingEditor api={api} draft={draft} roomName={room.name}
          onChange={(next) => { setDraft(next); setSuccess(''); }}
          onConflict={availability.reload}
          onSuccess={(booking) => {
            setSuccess('Бронирование создано.');
            setDraft({ roomId: room.id, title: '', description: '', ...nextSlot(officeDay(booking.start)) });
            setDay(officeDay(booking.start));
            availability.reload();
          }} />
      </section>
    </div>
  </>;
}
