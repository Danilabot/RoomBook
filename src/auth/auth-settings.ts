export const AUTH_SETTINGS = Symbol('AUTH_SETTINGS');
export const OIDC_CLIENT_ID = 'roombook-web';
export const OIDC_AUDIENCE = 'roombook-api';
export const LOGIN_CALLBACK = '/api/auth/callback';
export const LOGOUT_CALLBACK = '/api/auth/logout/callback';

export interface AuthSettings {
  origin: string;
  issuer: string;
  internalOrigin?: string;
  clientSecret: string;
  encryptionKey: string;
  localHttp: boolean;
}

const isLoopback = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);

function readUrl(env: NodeJS.ProcessEnv, name: string, allowHttp: boolean, isOrigin = true): URL {
  const value = env[name];
  const url = URL.canParse(value ?? '') ? new URL(value!) : undefined;
  if (
    !url || url.username || url.password || url.search || url.hash ||
    !(url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')) ||
    (isOrigin ? value !== url.origin : value !== url.href || url.pathname.endsWith('/'))
  ) throw new Error(name + ' must be a canonical ' + (isOrigin ? 'origin' : 'issuer URL'));
  return url;
}

export function authSettings(env: NodeJS.ProcessEnv = process.env): AuthSettings {
  const allow = env.OIDC_ALLOW_LOCAL_HTTP;
  if (allow !== undefined && allow !== 'true' && allow !== 'false') {
    throw new Error('OIDC_ALLOW_LOCAL_HTTP must be true or false');
  }
  const localHttp = allow === 'true';
  const origin = readUrl(env, 'APP_ORIGIN', localHttp);
  const issuer = readUrl(env, 'OIDC_ISSUER', localHttp, false);
  const internal = env.OIDC_INTERNAL_ORIGIN ? readUrl(env, 'OIDC_INTERNAL_ORIGIN', localHttp) : undefined;
  if (localHttp && (!isLoopback(origin.hostname) || !isLoopback(issuer.hostname))) {
    throw new Error('OIDC_ALLOW_LOCAL_HTTP requires loopback browser origins');
  }
  if (internal?.protocol === 'http:' && !isLoopback(internal.hostname) && internal.hostname !== 'keycloak') {
    throw new Error('OIDC_INTERNAL_ORIGIN HTTP requires keycloak or a loopback host');
  }
  const clientSecret = env.OIDC_CLIENT_SECRET;
  if (!clientSecret?.trim()) throw new Error('OIDC_CLIENT_SECRET is required');
  const encryptionKey = env.SESSION_ENCRYPTION_KEY;
  if (!encryptionKey || !/^[a-f0-9]{64}$/i.test(encryptionKey) || encryptionKey === clientSecret) {
    throw new Error('SESSION_ENCRYPTION_KEY must be a separate 64-character hex key');
  }
  return {
    origin: origin.origin, issuer: issuer.href, internalOrigin: internal?.origin,
    clientSecret, encryptionKey, localHttp: origin.protocol === 'http:',
  };
}
