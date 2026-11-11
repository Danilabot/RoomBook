import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthSchema1760000000001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = queryRunner.connection.driver.escape(queryRunner.connection.driver.schema ?? 'public');
    await queryRunner.query(`
      CREATE TABLE ${schema}.oidc_transactions (
        state_hash text PRIMARY KEY,
        browser_hash text NOT NULL,
        purpose text NOT NULL CHECK (purpose IN ('login', 'logout')),
        payload_encrypted text NOT NULL,
        expires_at timestamptz NOT NULL
      );
      CREATE INDEX oidc_transactions_expiry ON ${schema}.oidc_transactions (expires_at);
      CREATE TABLE ${schema}.auth_sessions (
        id_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES ${schema}.users(id) ON DELETE CASCADE,
        provider_sid text NOT NULL,
        tokens_encrypted text NOT NULL,
        access_expires_at timestamptz NOT NULL,
        idle_expires_at timestamptz NOT NULL,
        absolute_expires_at timestamptz NOT NULL,
        CHECK (idle_expires_at <= absolute_expires_at)
      );
      CREATE INDEX auth_sessions_idle_expiry ON ${schema}.auth_sessions (idle_expires_at);
      CREATE INDEX auth_sessions_user ON ${schema}.auth_sessions (user_id);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = queryRunner.connection.driver.escape(queryRunner.connection.driver.schema ?? 'public');
    await queryRunner.query(`DROP TABLE ${schema}.auth_sessions, ${schema}.oidc_transactions`);
  }
}
