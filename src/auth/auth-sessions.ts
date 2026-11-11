import { ForbiddenException, Inject, Injectable, type OnModuleInit, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { AUTH_SETTINGS, type AuthSettings } from './auth-settings.js';
import type { Actor } from './actor.js';
import { OidcProvider, type VerifiedTokens } from './oidc-provider.js';
import { isOpaqueSecret, opaqueSecret, secretHash, secretsEqual, SessionSecrets } from './session-secrets.js';

interface SessionPayload extends Omit<VerifiedTokens, 'expiresAt'> {
  csrf: string;
}

interface SessionRow {
  id_hash: string;
  user_id: string;
  oidc_subject: string;
  provider_sid: string;
  tokens_encrypted: string;
  access_expires_at: Date;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  email: string | null;
}

export interface Principal extends Actor {
  email: string | null;
}

export interface WriteProof {
  origin?: string | string[];
  token?: string | string[];
}

type Purpose = 'login' | 'logout';

@Injectable()
export class AuthSessions implements OnModuleInit {
  private readonly sessions: string;
  private readonly attempts: string;
  private readonly users: string;
  private readonly encryption: SessionSecrets;

  constructor(
    private readonly db: DataSource,
    private readonly provider: OidcProvider,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
  ) {
    const schema = db.driver.escape(db.driver.schema ?? 'public');
    this.sessions = schema + '.auth_sessions';
    this.attempts = schema + '.oidc_transactions';
    this.users = schema + '.users';
    this.encryption = new SessionSecrets(settings.encryptionKey);
  }

  async onModuleInit(): Promise<void> {
    await this.bounded(async (manager) => {
      await manager.query(`DELETE FROM ${this.sessions} s USING ${this.users} u
        WHERE s.user_id=u.id AND u.oidc_issuer<>$1`, [this.settings.issuer]);
    });
  }

  private attemptContext(purpose: Purpose, stateHash: string): string {
    return `${purpose}:${this.settings.issuer}:${stateHash}`;
  }

  private async bounded<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(async (manager) => {
        await manager.query("SET LOCAL lock_timeout = '2s'");
        await manager.query("SET LOCAL statement_timeout = '5s'");
        await manager.query("SET LOCAL idle_in_transaction_session_timeout = '20s'");
        return operation(manager);
      });
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Session storage temporarily unavailable');
    }
  }

  private async saveAttempt(purpose: Purpose, state: string, binding: string, value: object): Promise<void> {
    const stateHash = secretHash(state);
    await this.bounded(async (manager) => {
      for (const [table, key, expiry] of [
        [this.attempts, 'state_hash', 'expires_at'],
        [this.sessions, 'id_hash', 'idle_expires_at'],
      ]) {
        await manager.query(`DELETE FROM ${table} WHERE ${key} IN (
          SELECT ${key} FROM ${table} WHERE ${expiry} <= now()
          ORDER BY ${expiry} LIMIT 50 FOR UPDATE SKIP LOCKED
        )`);
      }
      await manager.query(`INSERT INTO ${this.attempts} (state_hash,browser_hash,purpose,payload_encrypted,expires_at)
        VALUES ($1,$2,$3,$4,now() + interval '5 minutes')`, [
        stateHash, secretHash(binding), purpose, this.encryption.seal(value, this.attemptContext(purpose, stateHash)),
      ]);
    });
  }

  private async consumeAttempt<T>(purpose: Purpose, state: unknown, binding: string | undefined): Promise<T> {
    if (!isOpaqueSecret(state) || !binding) throw new UnauthorizedException('Invalid identity provider transaction');
    const stateHash = secretHash(state);
    const [attempt] = await this.bounded(async (manager) => manager.query(`WITH consumed AS (
      DELETE FROM ${this.attempts} WHERE state_hash=$1 AND browser_hash=$2
        AND purpose=$3 AND expires_at>clock_timestamp() RETURNING payload_encrypted
    ) SELECT payload_encrypted FROM consumed`, [stateHash, secretHash(binding), purpose])) as { payload_encrypted: string }[];
    try {
      if (!attempt) throw new Error();
      return this.encryption.open<T>(attempt.payload_encrypted, this.attemptContext(purpose, stateHash));
    } catch {
      throw new UnauthorizedException('Invalid identity provider transaction');
    }
  }

  async startLogin(): Promise<{ url: URL; binding: string }> {
    const state = opaqueSecret();
    const binding = opaqueSecret();
    const attempt = { verifier: opaqueSecret(), nonce: opaqueSecret() };
    const url = await this.provider.authorizationUrl(state, attempt);
    await this.saveAttempt('login', state, binding, attempt);
    return { url, binding };
  }

  async finishLogin(url: URL, binding: string | undefined, priorSession: string | undefined): Promise<string> {
    const states = url.searchParams.getAll('state');
    const state = states.length === 1 ? states[0] : undefined;
    const attempt = await this.consumeAttempt<{ verifier: string; nonce: string }>('login', state, binding);
    const identity = await this.provider.exchange(url, state!, attempt);
    const session = opaqueSecret();
    const hash = secretHash(session);
    const { subject, sid, name, email, expiresAt, ...tokens } = identity;
    await this.bounded(async (manager) => {
      const [{ id }] = await manager.query(`INSERT INTO ${this.users} (oidc_issuer, oidc_subject, name, email)
        VALUES ($1,$2,$3,$4) ON CONFLICT (oidc_issuer,oidc_subject)
        DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, updated_at=now() RETURNING id`,
      [this.settings.issuer, subject, name, email]) as { id: string }[];
      if (priorSession) await this.deleteSession(manager, secretHash(priorSession));
      const payload = this.encryption.seal({ ...tokens, csrf: opaqueSecret() }, this.context(hash, id));
      await manager.query(`INSERT INTO ${this.sessions}
        (id_hash,user_id,provider_sid,tokens_encrypted,access_expires_at,idle_expires_at,absolute_expires_at)
        VALUES ($1,$2,$3,$4,$5,now() + interval '30 minutes',now() + interval '8 hours')`,
      [hash, id, sid, payload, expiresAt]);
    });
    return session;
  }

  private context(hash: string, userId: string): string {
    return `session:${hash}:${userId}`;
  }

  private async lockSession(manager: EntityManager, session: string | undefined): Promise<SessionRow> {
    if (!session) throw new UnauthorizedException();
    const [row] = await manager.query(`SELECT s.*,u.oidc_subject,u.email FROM ${this.sessions} s
      JOIN ${this.users} u ON u.id=s.user_id WHERE s.id_hash=$1 AND u.oidc_issuer=$2 FOR UPDATE OF s`,
    [secretHash(session), this.settings.issuer]) as SessionRow[];
    if (!row || this.expired(row)) throw new UnauthorizedException();
    return row;
  }

  private expired(row: SessionRow): boolean {
    return Math.min(row.idle_expires_at.getTime(), row.absolute_expires_at.getTime()) <= Date.now();
  }

  private decrypt(row: SessionRow): SessionPayload {
    try {
      return this.encryption.open<SessionPayload>(row.tokens_encrypted, this.context(row.id_hash, row.user_id));
    } catch {
      throw new ServiceUnavailableException('Session credentials unavailable');
    }
  }

  private assertWrite(payload: SessionPayload, proof: WriteProof): void {
    if (proof.origin !== this.settings.origin || !isOpaqueSecret(proof.token) || !secretsEqual(payload.csrf, proof.token)) {
      throw new ForbiddenException('Invalid request origin or CSRF token');
    }
  }

  private async deleteSession(manager: EntityManager, hash: string): Promise<void> {
    await manager.query(`DELETE FROM ${this.sessions} WHERE id_hash=$1`, [hash]);
  }

  async authenticate(session: string | undefined, proof?: WriteProof): Promise<Principal> {
    if (!session) throw new UnauthorizedException();
    let spent: SessionRow | undefined;
    let principal: Principal | undefined;
    try {
      principal = await this.bounded(async (manager) => {
        const row = await this.lockSession(manager, session);
        const context = this.context(row.id_hash, row.user_id);
        let payload = this.decrypt(row);
        if (proof) this.assertWrite(payload, proof);
        let expiry = row.access_expires_at;
        let encrypted = row.tokens_encrypted;
        if (expiry.getTime() <= Date.now()) {
          try {
            const { expiresAt, ...fresh } = await this.provider.refresh(
              { ...payload, expiresAt: expiry }, row.oidc_subject, row.provider_sid, () => { spent = row; },
            );
            if (this.expired(row)) throw new UnauthorizedException();
            payload = { ...fresh, csrf: payload.csrf };
            expiry = expiresAt;
            encrypted = this.encryption.seal(payload, context);
          } catch (error) {
            if (!spent && !(error instanceof UnauthorizedException)) throw error;
            await this.deleteSession(manager, row.id_hash);
            return undefined;
          }
        }
        await manager.query(`UPDATE ${this.sessions}
          SET idle_expires_at=LEAST(absolute_expires_at, clock_timestamp() + interval '30 minutes'),
              access_expires_at=$2, tokens_encrypted=$3 WHERE id_hash=$1`, [row.id_hash, expiry, encrypted]);
        return { id: row.user_id, email: row.email, roles: payload.roles };
      });
    } catch (error) {
      if (!spent || await this.stillHasSessionAfterRevocation(spent)) throw error;
      throw new UnauthorizedException('Sign in again');
    }
    if (!principal) throw new UnauthorizedException('Sign in again');
    if (principal.roles.length === 0) throw new ForbiddenException();
    return principal;
  }

  private async stillHasSessionAfterRevocation(spent: SessionRow): Promise<boolean> {
    return this.bounded(async (manager) => {
      // A failed write or commit may have rolled back. Revoke only the old ciphertext so
      // another transaction's successfully stored replacement survives an ambiguous commit.
      await manager.query(`DELETE FROM ${this.sessions} WHERE id_hash=$1 AND tokens_encrypted=$2`,
        [spent.id_hash, spent.tokens_encrypted]);
      const rows = await manager.query(`SELECT 1 FROM ${this.sessions} WHERE id_hash=$1`, [spent.id_hash]) as unknown[];
      return rows.length > 0;
    });
  }

  async csrf(session: string | undefined): Promise<string> {
    if (!session) throw new UnauthorizedException();
    return this.bounded(async (manager) => this.decrypt(await this.lockSession(manager, session)).csrf);
  }

  async logout(session: string | undefined, proof: WriteProof): Promise<{ url?: URL; binding?: string }> {
    if (!session) throw new UnauthorizedException();
    await this.bounded(async (manager) => {
      const row = await this.lockSession(manager, session);
      this.assertWrite(this.decrypt(row), proof);
      await this.deleteSession(manager, row.id_hash);
    });

    try {
      const state = opaqueSecret();
      const binding = opaqueSecret();
      const url = await this.provider.logoutUrl(state);
      await this.saveAttempt('logout', state, binding, {});
      return { url, binding };
    } catch {
      return {};
    }
  }

  async finishLogout(state: unknown, binding: string | undefined): Promise<void> {
    await this.consumeAttempt('logout', state, binding);
  }
}
