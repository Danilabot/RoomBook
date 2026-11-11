import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { AuthSessions } from '../src/auth/auth-sessions.js';
import { OidcProvider } from '../src/auth/oidc-provider.js';
import { authSettings } from '../src/auth/auth-settings.js';
import { configureApp } from '../src/configure-app.js';
import { databaseOptions } from '../src/database/options.js';

const dbUrl = process.env.TEST_DATABASE_URL;
assert.ok(dbUrl, 'Set TEST_DATABASE_URL to a disposable PostgreSQL database');
const schema = 'test_' + randomUUID().replaceAll('-', '');
const origin = 'http://localhost:3100';
const keys = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(keys.publicKey), kid: 'fixture-key', alg: 'RS256' };
let issuer: string;
let nonce: string;
let challenge: string;
let variant = 'valid';
let roles = ['employee'];
let subject = 'keycloak-subject';
let email = 'employee@example.test';
let refreshes = 0;
let validRefreshToken = 'fixture-refresh-token';
let keyFetchUnavailable = false;
let app: INestApplication;
let bootstrap: DataSource;
let db: DataSource;
const fixture = createServer(async (req, res) => {
  const json = (status: number, body: unknown) =>
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  try {
    const path = req.url?.split('?')[0];
    const base = '/realms/roombook';
    if (path === base + '/.well-known/openid-configuration') {
      if (variant === 'outage') return json(503, {});
      return json(200, {
        issuer, authorization_endpoint: issuer + '/auth', token_endpoint: issuer + '/token',
        jwks_uri: issuer + '/jwks', end_session_endpoint: issuer + '/logout',
        id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
      });
    }
    if (path === base + '/jwks') return keyFetchUnavailable ? json(503, {}) : json(200, { keys: [jwk] });
    if (path !== base + '/token') return json(404, {});
    let body = '';
    for await (const chunk of req) body += String(chunk);
    const params = new URLSearchParams(body);
    const refreshing = params.get('grant_type') === 'refresh_token';
    if (refreshing) {
      refreshes++;
      if (params.get('refresh_token') !== validRefreshToken) return json(400, { error: 'invalid_grant' });
    }
    else assert.equal(createHash('sha256').update(params.get('code_verifier') ?? '').digest('base64url'), challenge);
    if (variant === 'outage') return json(503, {});
    if (variant === 'invalid_grant') return json(400, { error: 'invalid_grant' });
    if (refreshing && ['rotate-before-jwks-outage', 'rotate-valid'].includes(variant)) {
      validRefreshToken = 'rotated-refresh-token';
      keyFetchUnavailable = variant === 'rotate-before-jwks-outage';
    }
    const iat = Math.floor(Date.now() / 1000);
    const sign = (aud: string, payload: Record<string, unknown>) =>
      new SignJWT(payload).setProtectedHeader({ alg: 'RS256',
        kid: refreshing && variant === 'rotate-before-jwks-outage' ? 'rotated-key' : 'fixture-key',
      })
        .setSubject(subject).setIssuer(issuer).setAudience(aud)
        .setIssuedAt(iat).setExpirationTime(iat + 300).sign(keys.privateKey);
    const access = await sign(variant === 'wrong-audience' ? 'unrelated-api' : 'roombook-api', {
      sid: variant === 'wrong-sid' ? 'unrelated-session' : 'keycloak-session',
      resource_access: { 'roombook-api': { roles }, account: { roles: ['admin'] } },
    });
    return json(200, {
      token_type: 'Bearer', access_token: variant === 'bad-signature' ? access.slice(0, -5) + '_____': access,
      refresh_token: validRefreshToken, expires_in: 300,
      ...(refreshing ? {} : { id_token: await sign('roombook-web', {
        nonce: variant === 'wrong-nonce' ? 'unrelated-nonce' : nonce,
        sid: 'keycloak-session', email, name: 'Test Employee',
      }) }),
    });
  } catch {
    return json(500, {});
  }
});

const api = () => request(app.getHttpServer());
const cookie = (res: { headers: Record<string, string> }, key: string) => {
  const cookies = res.headers['set-cookie'] as unknown as string[];
  const value = cookies?.find((line) => line.startsWith(key + '='));
  assert.ok(value);
  assert.match(value, /; HttpOnly; SameSite=Lax/);
  return value.split(';')[0];
};
async function startLogin() {
  const start = await api().get('/api/auth/login').expect(302).expect('Cache-Control', 'no-store');
  const url = new URL(start.headers.location);
  assert.equal(url.origin, new URL(issuer).origin);
  assert.equal(url.searchParams.get('redirect_uri'), origin + '/api/auth/callback');
  assert.equal(url.searchParams.get('client_id'), 'roombook-web');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  nonce = url.searchParams.get('nonce') ?? '';
  challenge = url.searchParams.get('code_challenge') ?? '';
  assert.ok(nonce && challenge);
  const binding = cookie(start, 'roombook_login');
  const state = url.searchParams.get('state');
  assert.ok(state);
  return { binding, state };
}
const callback = (binding: string, state: string) =>
  api().get('/api/auth/callback').set('Cookie', binding).query({ state, code: 'fixture-code', iss: issuer });
async function login() {
  const { binding, state } = await startLogin();
  const response = await callback(binding, state).expect(302).expect('Location', origin + '/');
  return cookie(response, 'roombook_session');
}
const csrf = async (session: string) =>
  (await api().get('/api/auth/csrf').set('Cookie', session).expect(200)).body.csrfToken as string;

before(async () => {
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  issuer = 'http://localhost:8180/realms/roombook';
  const internalOrigin = 'http://127.0.0.1:' + (fixture.address() as AddressInfo).port;
  Object.assign(process.env, {
    DATABASE_URL: dbUrl, DATABASE_SCHEMA: schema, APP_ORIGIN: origin, OIDC_ISSUER: issuer,
    OIDC_INTERNAL_ORIGIN: internalOrigin, OIDC_CLIENT_SECRET: 'fixture-only-client-secret', OIDC_ALLOW_LOCAL_HTTP: 'true',
    SESSION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  });
  bootstrap = await new DataSource({ type: 'postgres', url: dbUrl }).initialize();
  await bootstrap.query('CREATE SCHEMA "' + schema + '"');
  db = await new DataSource(databaseOptions()).initialize();
  await db.runMigrations();
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  configureApp(app);
  await app.init();
});
after(async () => {
  await app?.close();
  if (db?.isInitialized) await db.destroy();
  if (bootstrap?.isInitialized) {
    await bootstrap.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    await bootstrap.destroy();
  }
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
});

test('rejects absent, forged and ambiguous cookies and does not trust authorization headers', async () => {
  const forged = 'roombook_session=' + randomBytes(32).toString('base64url');
  await api().get('/api/rooms').set('Authorization', 'admin').expect(401);
  await api().get('/api/auth/me').set('Cookie', forged).expect(401).expect('Cache-Control', 'no-store');
  const session = await login();
  await api().get('/api/auth/me').set('Cookie', session + '; ' + forged).expect(401);
});

test('binds callbacks to one browser and consumes matching attempts once', async () => {
  const { binding, state } = await startLogin();
  await callback('roombook_login=' + randomBytes(32).toString('base64url'), state).expect(401);
  await callback(binding, randomBytes(32).toString('base64url')).expect(401);
  await callback(binding, state).expect(302);
  await callback(binding, state).expect(401);
});

test('rejects a valid session and pending callback from another issuer', async () => {
  const session = await login();
  const { binding, state } = await startLogin();
  const alternate = new AuthSessions(db, app.get(OidcProvider), {
    ...authSettings(), issuer: 'http://localhost:8080/realms/notes',
  });
  const cookieValue = (value: string) => value.slice(value.indexOf('=') + 1);
  await assert.rejects(alternate.authenticate(cookieValue(session)), { status: 401 });
  await assert.rejects(alternate.csrf(cookieValue(session)), { status: 401 });

  const url = new URL(origin + '/api/auth/callback');
  url.search = new URLSearchParams({ state, code: 'fixture-code', iss: issuer }).toString();
  await assert.rejects(alternate.finishLogin(url, cookieValue(binding), undefined), { status: 401 });
  await api().get('/api/auth/me').set('Cookie', session).expect(200);
});

test('rejects invalid token signature, nonce, audience and provider session identity', async () => {
  try {
    for (variant of ['bad-signature', 'wrong-nonce', 'wrong-audience', 'wrong-sid']) {
      const { binding, state } = await startLogin();
      const response = await callback(binding, state).expect(401);
      assert.ok(!((response.headers['set-cookie'] as unknown as string[] | undefined) ?? []).some((line: string) => line.startsWith('roombook_session=')));
    }
  } finally { variant = 'valid'; }
});

test('enforces resource roles and the exact Origin and session CSRF on writes', async () => {
  const employee = await login();
  const me = await api().get('/api/auth/me').set('Cookie', employee).expect(200);
  assert.deepEqual(me.body, { id: me.body.id, email: 'employee@example.test', roles: ['employee'] });
  assert.match(me.body.id, /^[0-9a-f-]{36}$/);
  const token = await csrf(employee);
  const post = (session: string) => api().post('/api/rooms').set('Cookie', session)
    .send({ name: 'Auth room', location: 'Here', capacity: 2, equipment: [] });
  await post(employee).set('Origin', origin).set('X-CSRF-Token', token).expect(403);
  roles = ['admin', 'unrecognized'];
  let admin: string;
  try { admin = await login(); } finally { roles = ['employee']; }
  const adminToken = await csrf(admin);
  await post(admin).set('Origin', origin).expect(403);
  await post(admin).set('Origin', origin + '.invalid').set('X-CSRF-Token', adminToken).expect(403);
  await post(admin).set('Origin', origin).set('X-CSRF-Token', token).expect(403);
  await post(admin).set('Origin', origin).set('X-CSRF-Token', adminToken).expect(201);
  const nextMe = await api().get('/api/auth/me').set('Cookie', admin).expect(200);
  assert.deepEqual(nextMe.body, { ...me.body, roles: ['admin'] });
});

async function expireAccess(session: string) {
  const hash = createHash('sha256').update(session.split('=')[1]).digest('hex');
  await db.query(`UPDATE "${schema}".auth_sessions SET access_expires_at=now() - interval '1 second' WHERE id_hash=$1`, [hash]);
}

test('serializes refresh, changes roles and preserves an otherwise valid session during provider outage', async () => {
  const session = await login();
  await expireAccess(session);
  variant = 'outage';
  try { await api().get('/api/auth/me').set('Cookie', session).expect(503); }
  finally { variant = 'valid'; }
  const before = refreshes;
  roles = ['admin'];
  try {
    const [a, b] = await Promise.all([
      api().get('/api/auth/me').set('Cookie', session).expect(200),
      api().get('/api/auth/me').set('Cookie', session).expect(200),
    ]);
    assert.deepEqual(a.body.roles, ['admin']);
    assert.deepEqual(b.body.roles, ['admin']);
    assert.equal(refreshes - before, 1);
  } finally { roles = ['employee']; }
  await expireAccess(session);
  variant = 'invalid_grant';
  try { await api().get('/api/auth/me').set('Cookie', session).expect(401); }
  finally { variant = 'valid'; }
  await api().get('/api/auth/me').set('Cookie', session).expect(401);
});

test('commits local logout even if Keycloak is down', async () => {
  const session = await login();
  const token = await csrf(session);
  variant = 'outage';
  try {
    const response = await api().post('/api/auth/logout').set('Cookie', session)
      .set('Origin', origin).set('X-CSRF-Token', token).expect(200);
    assert.deepEqual(response.body, { localLoggedOut: true, ssoStatus: 'unavailable' });
  } finally { variant = 'valid'; }
  await api().get('/api/auth/me').set('Cookie', session).expect(401);
});

test('builds browser SSO logout without exposing tokens and consumes the logout callback once', async () => {
  const session = await login();
  const token = await csrf(session);
  const response = await api().post('/api/auth/logout').set('Cookie', session)
    .set('Origin', origin).set('X-CSRF-Token', token).expect(200);
  assert.equal(response.body.localLoggedOut, true);
  assert.equal(response.body.ssoStatus, 'pending');
  const url = new URL(response.body.logoutUrl);
  assert.equal(url.searchParams.get('id_token_hint'), null);
  const state = url.searchParams.get('state');
  assert.ok(state);
  const binding = cookie(response, 'roombook_logout');
  const callback = () => api().get('/api/auth/logout/callback').set('Cookie', binding).query({ state });
  await callback().expect(302).expect('Location', origin + '/');
  await callback().expect(401);
  await api().get('/api/auth/me').set('Cookie', session).expect(401);
});

test('uses issuer and subject for account identity when email changes or is shared', async () => {
  const me = async () => {
    const session = await login();
    return (await api().get('/api/auth/me').set('Cookie', session).expect(200)).body;
  };
  const initial = await me();
  email = 'changed@example.test';
  try {
    const renamed = await me();
    assert.equal(renamed.id, initial.id);
    assert.equal(renamed.email, 'changed@example.test');
    subject = 'different-subject';
    const other = await me();
    assert.equal(other.email, renamed.email);
    assert.notEqual(other.id, initial.id);
  } finally {
    email = 'employee@example.test';
    subject = 'keycloak-subject';
  }
});

test('enforces attempt expiry, idle expiry and the absolute limit without refreshing', async () => {
  const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');
  const { binding, state } = await startLogin();
  await db.query(`UPDATE "${schema}".oidc_transactions SET expires_at=now() WHERE state_hash=$1`, [hash(state)]);
  await callback(binding, state).expect(401);

  const before = refreshes;
  const idle = await login();
  await db.query(`UPDATE "${schema}".auth_sessions SET idle_expires_at=now() - interval '1 second' WHERE id_hash=$1`,
    [hash(idle.split('=')[1])]);
  await api().get('/api/auth/me').set('Cookie', idle).expect(401);

  const absolute = await login();
  const id = hash(absolute.split('=')[1]);
  await db.query(`UPDATE "${schema}".auth_sessions SET absolute_expires_at=now() + interval '1 minute',
    idle_expires_at=now() + interval '30 seconds' WHERE id_hash=$1`, [id]);
  await api().get('/api/auth/me').set('Cookie', absolute).expect(200);
  const [{ capped }] = await db.query(`SELECT idle_expires_at=absolute_expires_at AS capped
    FROM "${schema}".auth_sessions WHERE id_hash=$1`, [id]) as { capped: boolean }[];
  assert.equal(capped, true);
  await db.query(`UPDATE "${schema}".auth_sessions SET absolute_expires_at=now() - interval '1 second',
    idle_expires_at=now() - interval '1 second' WHERE id_hash=$1`, [id]);
  await api().get('/api/auth/me').set('Cookie', absolute).expect(401);
  assert.equal(refreshes, before);
});

test('requires explicit local HTTP and a separate validated encryption key', () => {
  const secure = {
    APP_ORIGIN: 'https://app.example.test', OIDC_ISSUER: 'https://sso.example.test/realms/roombook',
    OIDC_CLIENT_SECRET: 'fixture-only-secret', SESSION_ENCRYPTION_KEY: '01'.repeat(32),
  };
  assert.equal(authSettings(secure).localHttp, false);
  assert.throws(() => authSettings({ ...secure, APP_ORIGIN: 'http://localhost:3100' }), /APP_ORIGIN/);
  assert.throws(() => authSettings({ ...secure, OIDC_ALLOW_LOCAL_HTTP: 'true' }), /loopback/);
  assert.throws(() => authSettings({ ...secure, SESSION_ENCRYPTION_KEY: secure.OIDC_CLIENT_SECRET }), /SESSION_ENCRYPTION_KEY/);
});

test('a user without app roles can obtain logout CSRF and revoke their session', async () => {
  const employee = await login();
  roles = [];
  try {
    const roleless = await login();
    await expireAccess(employee);
    for (const session of [roleless, employee]) {
      await api().get('/api/auth/me').set('Cookie', session).expect(403);
      await api().get('/api/rooms').set('Cookie', session).expect(403);
      const token = await csrf(session);
      await api().post('/api/auth/logout').set('Cookie', session)
        .set('Origin', origin).set('X-CSRF-Token', token).expect(200);
      await api().get('/api/auth/csrf').set('Cookie', session).expect(401);
    }
  } finally { roles = ['employee']; }
});

test('revokes a session when a successful rotating refresh cannot verify its replacement', async () => {
  const session = await login();
  // A fresh provider client has no cached JWKS, so post-grant verification must fetch them.
  const fresh = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  configureApp(fresh);
  await fresh.init();
  try {
    await expireAccess(session);
    variant = 'rotate-before-jwks-outage';
    const freshApi = request(fresh.getHttpServer());
    await freshApi.get('/api/auth/me').set('Cookie', session).expect(401);
    assert.equal(validRefreshToken, 'rotated-refresh-token');
    keyFetchUnavailable = false;
    variant = 'valid';
    const before = refreshes;
    await freshApi.get('/api/auth/me').set('Cookie', session).expect(401);
    assert.equal(refreshes, before);
  } finally {
    keyFetchUnavailable = false;
    validRefreshToken = 'fixture-refresh-token';
    variant = 'valid';
    await fresh.close();
  }
});

test('outside local HTTP the browser cookies use the Secure host prefix and root path', async () => {
  process.env.APP_ORIGIN = 'https://localhost:3100';
  let secureApp: INestApplication | undefined;
  try {
    secureApp = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    configureApp(secureApp);
    await secureApp.init();
    const secureApi = request(secureApp.getHttpServer());
    const login = await secureApi.get('/api/auth/login').expect(302);
    const headers = login.headers['set-cookie'] as unknown as string[];
    assert.match(headers[0], /^__Host-roombook_login=[^;]+; Max-Age=300; Path=\/;/);
    assert.match(headers[0], /; HttpOnly; Secure; SameSite=Lax/);
    const authUrl = new URL(login.headers.location);
    nonce = authUrl.searchParams.get('nonce') ?? '';
    challenge = authUrl.searchParams.get('code_challenge') ?? '';
    const loginCookie = headers[0].split(';')[0];
    const state = authUrl.searchParams.get('state');
    const result = await secureApi.get('/api/auth/callback').set('Cookie', loginCookie)
      .query({ state, code: 'fixture-code', iss: issuer }).expect(302);
    const cookies = result.headers['set-cookie'] as unknown as string[];
    const session = cookies.find((line) => line.startsWith('__Host-roombook_session='));
    assert.ok(session);
    assert.match(session, /; Path=\/;/);
    assert.match(session, /; HttpOnly; Secure; SameSite=Lax/);
    await secureApi.get('/api/auth/me').set('Cookie', session.split(';')[0]).expect(200);
  } finally {
    process.env.APP_ORIGIN = origin;
    await secureApp?.close();
  }
});

test('revokes the old session if storage rejects a verified rotating refresh', async () => {
  const session = await login();
  await expireAccess(session);
  await db.query(`CREATE FUNCTION "${schema}".reject_auth_refresh() RETURNS trigger LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'fixture write failure'; END; $$;
    CREATE TRIGGER reject_auth_refresh BEFORE UPDATE OF tokens_encrypted ON "${schema}".auth_sessions
    FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_auth_refresh()`);
  try {
    variant = 'rotate-valid';
    await api().get('/api/auth/me').set('Cookie', session).expect(401);
    assert.equal(validRefreshToken, 'rotated-refresh-token');
    const before = refreshes;
    await api().get('/api/auth/csrf').set('Cookie', session).expect(401);
    await api().get('/api/auth/me').set('Cookie', session).expect(401);
    assert.equal(refreshes, before);
  } finally {
    await db.query(`DROP TRIGGER reject_auth_refresh ON "${schema}".auth_sessions;
      DROP FUNCTION "${schema}".reject_auth_refresh()`);
    validRefreshToken = 'fixture-refresh-token';
    variant = 'valid';
  }
});
