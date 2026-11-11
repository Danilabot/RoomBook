import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const roomBook = dirname(dirname(fileURLToPath(import.meta.url)));
const notes = resolve(process.argv[2] ?? join(roomBook, '..', 'notes-api'));
const origin = 'http://localhost:8080';
const adminBase = origin + '/admin/realms/notes';
const managedBy = 'RoomBook shared local SSO';
const roomBookEnv = join(roomBook, '.env');

function saveSecret(text, secret) {
  const temporary = roomBookEnv + '.' + randomUUID();
  try {
    const withoutBlank = text.replace(/^SHARED_OIDC_CLIENT_SECRET=.*\r?\n?/gm, '').trimEnd();
    writeFileSync(temporary, withoutBlank + '\nSHARED_OIDC_CLIENT_SECRET=' + secret + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, roomBookEnv);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function backupKeycloak() {
  const folder = join(roomBook, '.local', 'keycloak-backups');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const path = join(folder, 'notes-keycloak-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID() + '.dump');
  const fd = openSync(path, 'wx', 0o600);
  try {
    const backup = spawnSync(process.env.DOCKER_BIN ?? 'docker', [
      'compose', '-p', 'notes-api', '-f', 'compose.full.yaml', '-f', 'compose.keycloak.yaml', '-f', 'compose.cutover.yaml',
      'exec', '-T', 'keycloak-db', 'pg_dump', '-U', 'keycloak', '-d', 'keycloak', '-Fc',
    ], { cwd: notes, stdio: ['ignore', fd, 'inherit'] });
    if (backup.status !== 0) throw new Error('Keycloak database backup failed.');
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  } finally {
    closeSync(fd);
  }
  console.log('Keycloak backup saved to ' + path);
}

async function validateClient(request, id, expected) {
  const path = '/clients/' + id;
  const client = await request(path);
  const flags = [
    'enabled', 'protocol', 'publicClient', 'clientAuthenticatorType', 'bearerOnly',
    'standardFlowEnabled', 'implicitFlowEnabled', 'directAccessGrantsEnabled',
    'serviceAccountsEnabled', 'fullScopeAllowed',
  ];
  const drift = (field) => {
    throw new Error(expected.clientId + ' differs from the RoomBook configuration (' + field +
      '). Restore this setting in the Notes Keycloak console and rerun setup.');
  };
  for (const key of flags) {
    if (expected[key] !== undefined && client[key] !== expected[key]) drift(key);
  }
  if (expected.redirectUris && JSON.stringify(client.redirectUris) !== JSON.stringify(expected.redirectUris)) {
    drift('redirectUris');
  }
  for (const [key, value] of Object.entries(expected.attributes ?? {})) {
    if (client.attributes?.[key] !== value) drift(key);
  }
  if (!expected.protocolMappers) return;
  const mappers = await request(path + '/protocol-mappers/models');
  if (mappers.length !== expected.protocolMappers.length) drift('protocol mappers');
  for (const mapper of expected.protocolMappers) {
    const actual = mappers.find(entry => entry.name === mapper.name);
    if (!actual || actual.protocol !== mapper.protocol || actual.protocolMapper !== mapper.protocolMapper ||
        Object.entries(mapper.config).some(([key, value]) => actual.config?.[key] !== value)) {
      drift(mapper.name);
    }
  }
}

async function setup() {
  const notesEnv = parseEnv(readFileSync(join(notes, '.env'), 'utf8'));
  const text = readFileSync(roomBookEnv, 'utf8');
  const oldSecret = parseEnv(text).SHARED_OIDC_CLIENT_SECRET;
  const secret = oldSecret || randomBytes(32).toString('hex');
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('SHARED_OIDC_CLIENT_SECRET must be a generated 64-character hex value.');
  const username = notesEnv.KEYCLOAK_ADMIN_USER;
  const password = notesEnv.KEYCLOAK_ADMIN_PASSWORD;
  if (!username || !password) throw new Error('Notes Keycloak administrator credentials are missing.');
  const login = await fetch(origin + '/realms/master/protocol/openid-connect/token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username, password }),
  });
  if (!login.ok) throw new Error('Notes Keycloak administrator authentication failed (HTTP ' + login.status + ').');
  const { access_token: adminToken } = await login.json();
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(adminBase + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { authorization: 'Bearer ' + adminToken, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(method + ' ' + path + ' failed (HTTP ' + response.status + ').');
    return method === 'GET' ? response.json() : undefined;
  };
  const [realm, providers, clients, scopes] = await Promise.all([
    request(''), request('/identity-provider/instances'), request('/clients'), request('/client-scopes'),
  ]);
  if (realm.realm !== 'notes' || !realm.enabled || !realm.defaultRole?.id ||
      !clients.some(client => client.clientId === 'notes-web' && client.enabled) ||
      !providers.some(provider => provider.providerId === 'google' && provider.enabled)) {
    throw new Error('The existing Notes realm, client and enabled Google provider are required.');
  }

  const { clients: templates } = JSON.parse(readFileSync(join(roomBook, 'deploy/keycloak/roombook-realm.json'), 'utf8'));
  const apiTemplate = templates.find(client => client.clientId === 'roombook-api');
  const standaloneWeb = templates.find(client => client.clientId === 'roombook-web');
  const webTemplate = {
    ...standaloneWeb, secret, attributes: { ...standaloneWeb.attributes, accessTokenLifespan: '300' },
  };
  for (const name of webTemplate.defaultClientScopes) {
    if (!scopes.some(scope => scope.name === name)) throw new Error('Notes realm lacks required OIDC scope ' + name);
  }
  for (const template of [apiTemplate, webTemplate]) {
    const existing = clients.find(client => client.clientId === template.clientId);
    if (!existing) continue;
    if (existing.description !== managedBy) throw new Error('Client already exists outside this setup: ' + template.clientId);
    if (template.clientId === 'roombook-web') {
      const existingSecret = await request('/clients/' + existing.id + '/client-secret');
      if (existingSecret.value !== secret) throw new Error('RoomBook shared client secret differs from the saved local value.');
    }
    await validateClient(request, existing.id, template);
  }

  backupKeycloak();
  if (!oldSecret) saveSecret(text, secret);

  async function ensureClient(template) {
    const existing = clients.find(client => client.clientId === template.clientId);
    if (existing) return existing;
    await request('/clients', 'POST', { ...template, description: managedBy });
    const [created] = await request('/clients?clientId=' + template.clientId);
    if (!created?.id) throw new Error('New RoomBook client did not appear.');
    await validateClient(request, created.id, template);
    return created;
  }

  const api = await ensureClient(apiTemplate);
  const web = await ensureClient(webTemplate);
  const apiPath = '/clients/' + api.id;
  const webPath = '/clients/' + web.id;

  for (const type of ['default', 'optional']) {
    const path = webPath + '/' + type + '-client-scopes';
    const assigned = await request(path);
    const wanted = new Set(type === 'default' ? webTemplate.defaultClientScopes : webTemplate.optionalClientScopes);
    for (const scope of assigned) {
      if (!wanted.has(scope.name)) await request(path + '/' + scope.id, 'DELETE');
    }
    for (const name of wanted) {
      const scope = scopes.find(entry => entry.name === name);
      if (!assigned.some(entry => entry.name === name)) await request(path + '/' + scope.id, 'PUT');
    }
  }

  let roles = await request(apiPath + '/roles');
  for (const name of ['employee', 'admin']) {
    if (!roles.some(role => role.name === name)) await request(apiPath + '/roles', 'POST', { name });
  }
  roles = (await request(apiPath + '/roles')).filter(role => ['employee', 'admin'].includes(role.name));
  const scopePath = webPath + '/scope-mappings/clients/' + api.id;
  const allowed = await request(scopePath);
  const missing = roles.filter(role => !allowed.some(entry => entry.id === role.id));
  if (missing.length) await request(scopePath, 'POST', missing);

  const employee = roles.find(role => role.name === 'employee');
  const defaultRolePath = '/roles-by-id/' + realm.defaultRole.id + '/composites';
  const defaults = await request(defaultRolePath);
  if (!defaults.some(role => role.id === employee.id)) await request(defaultRolePath, 'POST', [employee]);

  let eligible = 0;
  let direct = 0;
  for (let first = 0; ; first += 100) {
    const users = await request('/users?first=' + first + '&max=100');
    for (const user of users) {
      if (user.serviceAccountClientId || user.username.startsWith('service-account-')) continue;
      eligible++;
      const path = '/users/' + user.id + '/role-mappings/clients/' + api.id;
      const effective = await request(path + '/composite');
      if (!effective.some(role => role.id === employee.id)) {
        await request(path, 'POST', [employee]);
        direct++;
      }
    }
    if (users.length < 100) break;
  }
  console.log('RoomBook client configured. Employee access checked for ' + eligible + ' users (' + direct + ' direct grants).');
}

async function run() {
  const folder = join(roomBook, '.local');
  mkdirSync(folder, { mode: 0o700, recursive: true });
  const lock = join(folder, 'setup-shared-sso.lock');
  let fd;
  try {
    fd = openSync(lock, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Shared SSO setup is locked by another run: ' + lock);
    throw error;
  }
  try {
    await setup();
  } finally {
    closeSync(fd);
    rmSync(lock);
  }
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
