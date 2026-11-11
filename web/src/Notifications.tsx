import { useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { type Api, type Notification } from './api';
import { dayTitle, officeClock, officeDay } from './time';
import { Empty, Loading, Problem, useAction, useResource } from './ui';

const eventLabels: Record<Notification['type'], string> = {
  booking_created: 'Бронирование создано',
  booking_updated: 'Бронирование изменено',
  booking_cancelled: 'Бронирование отменено',
  booking_reminder: 'Напоминание о встрече',
};

export function Notifications({ api }: { api: Api }) {
  const [updates, setUpdates] = useState<Record<string, Notification>>({});
  const inbox = useResource<Notification[]>(api, '/notifications');
  const messages = inbox.data?.map((item) => updates[item.id] ?? item);
  const unread = messages?.filter((item) => !item.readAt).length ?? 0;
  return <section aria-labelledby="inbox-heading">
    <div className="page-heading"><h1 id="inbox-heading">Уведомления</h1>
      <p>Изменения бронирований и напоминания о встречах.</p>
      {messages && <span className="result-count" role="status">Непрочитанных: {unread}</span>}
    </div>
    {inbox.loading && <Loading />}
    <Problem error={inbox.error} retry={inbox.reload} />
    {messages?.length === 0 && <Empty>Уведомлений пока нет</Empty>}
    <div className="item-stack">{messages?.map((message) => <InboxItem key={message.id} api={api} message={message}
      onRead={(updated) => setUpdates((current) => ({ ...current, [updated.id]: updated }))} />)}</div>
  </section>;
}

function InboxItem({ api, message, onRead }: { api: Api; message: Notification; onRead: (updated: Notification) => void }) {
  const action = useAction();
  return <article className={'panel notification-item' + (message.readAt ? '' : ' unread')}>
    <div className="item-main">
      <span className="item-icon"><Bell aria-hidden="true" /></span>
      <div className="item-content">
        <h2>{eventLabels[message.type]}</h2>
        <p>{message.title}</p>
        <time dateTime={message.createdAt} className="help">
          {dayTitle(officeDay(message.createdAt))} · {officeClock(message.createdAt)} МСК
        </time>
      </div>
      {!message.readAt && <span className="pill free">Новое</span>}
    </div>
    <Problem error={action.error} />
    {!message.readAt && <div className="actions item-actions"><button type="button" className="button secondary small"
      disabled={action.busy} onClick={() => void action.run(async () => {
        onRead(await api.write<Notification>('/notifications/' + message.id + '/read', 'PATCH'));
      })}><Check aria-hidden="true" /> Отметить прочитанным</button></div>}
  </article>;
}
