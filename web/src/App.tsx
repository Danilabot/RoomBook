import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bell, CalendarDays, DoorOpen, LogOut, Settings2, ShieldCheck } from 'lucide-react';
import { ApiError, createApi, type Api, type Profile, type Room } from './api';
import { Admin } from './Admin';
import { Bookings } from './Bookings';
import { Catalog } from './Catalog';
import { Notifications } from './Notifications';
import { Loading, Problem, Status, useAction, useResource } from './ui';

type View = 'catalog' | 'bookings' | 'notifications' | 'admin';
const navigation = [
  { view: 'catalog', text: 'Переговорные', Icon: DoorOpen },
  { view: 'bookings', text: 'Мои бронирования', Icon: CalendarDays },
  { view: 'notifications', text: 'Уведомления', Icon: Bell },
  { view: 'admin', text: 'Управление', Icon: Settings2 },
] as const;

function Brand() {
  return <span className="brand"><span className="brand-mark"><DoorOpen aria-hidden="true" /></span>RoomBook</span>;
}

function Entry({ error, loading, retry, forbidden, api, onExit, signedOut }: {
  error: unknown; loading: boolean; retry: () => void; forbidden: boolean; api: Api;
  onExit: (notice: string) => void; signedOut: string;
}) {
  return <div className="entry">
    <header className="entry-header"><Brand /></header>
    <main className="entry-main" id="main-content">
      <div className="entry-card">
        <div className="entry-icon"><ShieldCheck aria-hidden="true" /></div>
        {loading ? <Loading /> : forbidden
          ? <>
            <h1>Доступ ограничен</h1>
            <p>У вашей учётной записи нет роли сотрудника или администратора RoomBook.</p>
            <Logout api={api} onExit={onExit} />
          </>
          : error
            ? <><h1>Не удалось проверить вход</h1><Problem error={error} retry={retry} /></>
            : <>
              <h1>Бронирование переговорных</h1>
              <p>Выберите комнату и время для следующей встречи.</p>
              <Status>{signedOut}</Status>
              <a className="button primary" href="/api/auth/login">Войти через SSO <ArrowRight aria-hidden="true" /></a>
            </>
        }
      </div>
      <div className="entry-art" aria-hidden="true"><div /><div /><div /></div>
    </main>
  </div>;
}

function Logout({ api, onExit }: { api: Api; onExit: (notice: string) => void }) {
  const action = useAction();
  return <div className="logout">
    <button className="button logout-button" type="button" disabled={action.busy} onClick={() => void action.run(async () => {
      const result = await api.write<{ localLoggedOut: true; ssoStatus: 'pending' | 'unavailable'; logoutUrl?: string }>('/auth/logout', 'POST');
      onExit(result.ssoStatus === 'unavailable' ? 'Вы вышли из RoomBook. Единый вход временно недоступен.' : '');
      if (result.logoutUrl) window.location.assign(result.logoutUrl);
    })}><LogOut aria-hidden="true" /> {action.busy ? 'Выходим…' : 'Выйти'}</button>
    {action.error != null && <div className="logout-error"><Problem error={action.error} /></div>}
  </div>;
}

export function App() {
  const [signedOut, setSignedOut] = useState<string | null>(null);
  const exit = useCallback((notice: string) => setSignedOut(notice), []);
  const api = useMemo(() => createApi(() => exit('')), [exit]);
  const auth = useResource<Profile>(api, signedOut === null ? '/auth/me' : null);
  const forbidden = auth.error instanceof ApiError && auth.error.status === 403;
  if (!auth.data || signedOut !== null) {
    return <Entry error={auth.error} loading={auth.loading} retry={auth.reload} forbidden={forbidden}
      api={api} onExit={exit} signedOut={signedOut ?? ''} />;
  }
  return <Workspace api={api} profile={auth.data} onExit={exit} />;
}

function Workspace({ api, profile, onExit }: { api: Api; profile: Profile; onExit: (notice: string) => void }) {
  const [view, setView] = useState<View>('catalog');
  const main = useRef<HTMLElement>(null);
  const shouldFocus = useRef(false);
  const isAdmin = profile.roles.includes('admin');
  const rooms = useResource<Room[]>(api, '/rooms?');
  useEffect(() => {
    if (shouldFocus.current) main.current?.focus();
  }, [view]);
  const navigate = (next: View) => {
    shouldFocus.current = true;
    setView(next);
  };
  return <>
    <a className="skip-link" href="#main-content">К основному содержанию</a>
    <header className="site-header">
      <div className="header-inner">
        <Brand />
        <nav className="main-nav" aria-label="Разделы RoomBook">
          {navigation.filter(({ view }) => view !== 'admin' || isAdmin).map(({ view: item, text, Icon }) =>
            <button key={item} type="button" aria-current={view === item ? 'page' : undefined} onClick={() => navigate(item)}>
              <Icon aria-hidden="true" /><span>{text}</span>
            </button>
          )}
        </nav>
        <div className="account">
          <span className="avatar" aria-hidden="true">{profile.email?.slice(0, 1).toLocaleUpperCase() ?? 'R'}</span>
          <span className="account-copy"><strong title={profile.email ?? undefined}>{profile.email ?? 'Учётная запись'}</strong>
            <small>{isAdmin ? 'Администратор' : 'Сотрудник'}</small>
          </span>
          <Logout api={api} onExit={onExit} />
        </div>
      </div>
    </header>
    <main className="workspace" id="main-content" ref={main} tabIndex={-1}>
      {view === 'catalog' && <Catalog api={api} rooms={rooms} />}
      {view === 'bookings' && <Bookings api={api} rooms={rooms.data ?? []} />}
      {view === 'notifications' && <Notifications api={api} />}
      {view === 'admin' && isAdmin && <Admin api={api} onRoomsChange={rooms.reload} />}
    </main>
    <footer className="site-footer"><span>RoomBook</span><span>Europe/Moscow · UTC+3</span></footer>
  </>;
}
