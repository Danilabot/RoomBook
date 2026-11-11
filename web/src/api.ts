export interface Profile {
  id: string;
  email: string | null;
  roles: ('employee' | 'admin')[];
}

export interface Room {
  id: string;
  name: string;
  location: string;
  capacity: number;
  description: string | null;
  equipment: string[];
  archived: boolean;
}

export interface Interval {
  start: string;
  end: string;
  kind: 'booking' | 'maintenance';
}

export interface Booking extends Interval {
  id: string;
  roomId: string;
  ownerId: string | null;
  status: 'active' | 'cancelled';
  title: string;
  description: string | null;
  cancellationReason: string | null;
}

export interface Notification {
  id: string;
  type: 'booking_created' | 'booking_updated' | 'booking_cancelled' | 'booking_reminder';
  title: string;
  readAt: string | null;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly conflicts: Booking[] = []) {
    super('HTTP ' + status);
  }
}

export type WriteMethod = 'POST' | 'PATCH' | 'DELETE';
export interface Api {
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
  write<T>(path: string, method: WriteMethod, payload?: unknown, key?: string): Promise<T>;
}

export function createApi(onUnauthorized: () => void): Api {
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch('/api' + path, { credentials: 'same-origin', ...options });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ApiError(503);
    }
    if (!response.ok) {
      if (response.status === 401 && !options.signal?.aborted) onUnauthorized();
      const data = await response.json().catch(() => null);
      throw new ApiError(response.status, Array.isArray(data?.conflicts) ? data.conflicts : []);
    }
    return response.json();
  }

  return {
    get: (path, signal) => request(path, { signal }),
    async write(path, method, payload, key) {
      const { csrfToken } = await request<{ csrfToken: string }>('/auth/csrf');
      const headers = new Headers({ 'X-CSRF-Token': csrfToken });
      if (payload !== undefined) headers.set('Content-Type', 'application/json');
      if (key) headers.set('Idempotency-Key', key);
      return request(path, { method, headers, body: JSON.stringify(payload) });
    },
  };
}

export function messageFor(error: unknown, conflictMessage = 'Данные уже изменились. Обновите страницу и повторите действие.') {
  if (typeof error === 'string') return error;
  switch (error instanceof ApiError ? error.status : 0) {
    case 400: return 'Проверьте введённые данные и попробуйте ещё раз.';
    case 401: return 'Войдите в систему снова.';
    case 403: return 'Для этого действия недостаточно прав.';
    case 404: return 'Эти данные больше недоступны.';
    case 409: return conflictMessage;
    case 502:
    case 503:
    case 504: return 'Сервис временно недоступен. Попробуйте ещё раз.';
    default: return 'Не удалось выполнить запрос. Попробуйте ещё раз.';
  }
}
