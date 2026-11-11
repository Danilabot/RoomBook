import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, Inbox, LoaderCircle } from 'lucide-react';
import { type Api, messageFor } from './api';

export function useResource<T>(api: Api, path: string | null) {
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{ path: string; revision: number; data?: T; error?: unknown }>();
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api.get<T>(path, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResponse({ path, revision, data });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setResponse({ path, revision, error });
      },
    );
    return () => controller.abort();
  }, [api, path, revision]);
  const current = response?.path === path && response.revision === revision ? response : undefined;
  return { data: current?.data, error: current?.error, loading: !!path && !current, reload: () => setRevision((n) => n + 1) };
}

export function useAction() {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function run(action: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(failure);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run, clear: () => setError(undefined) };
}

export function Problem({ error, retry, conflict }: { error: unknown; retry?: () => void; conflict?: string }) {
  if (!error) return null;
  return <div className="notice error" role="alert">
    <AlertCircle aria-hidden="true" />
    <span>{messageFor(error, conflict)}</span>
    {retry && <button type="button" className="button secondary small" onClick={retry}>Повторить</button>}
  </div>;
}

export function Loading() {
  return <p className="notice loading" role="status"><LoaderCircle aria-hidden="true" /> Загружаем данные…</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty"><Inbox aria-hidden="true" /><p>{children}</p></div>;
}

export function Status({ children }: { children: ReactNode }) {
  return <div className={children ? 'notice success' : 'sr-only'} role="status">{children}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function TimeFields({ value, change }: { value: { start: string; end: string }; change: (part: 'start' | 'end', value: string) => void }) {
  return <div className="field-row">
    <Field label="Начало"><input type="datetime-local" required value={value.start} onChange={(e) => change('start', e.target.value)} /></Field>
    <Field label="Окончание"><input type="datetime-local" required value={value.end} onChange={(e) => change('end', e.target.value)} /></Field>
  </div>;
}

export function submit(action: () => void) {
  return (event: FormEvent) => {
    event.preventDefault();
    action();
  };
}

const seatForms = { one: 'место', few: 'места', many: 'мест', other: 'мест', zero: 'мест', two: 'места' };
const plural = new Intl.PluralRules('ru');

export function seatCount(capacity: number) {
  return capacity + ' ' + seatForms[plural.select(capacity)];
}
