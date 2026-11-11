import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBookingSchema1760000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = queryRunner.connection.driver.escape(queryRunner.connection.driver.schema ?? 'public');
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public');
    await queryRunner.query(`
      CREATE TABLE ${schema}.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        oidc_issuer text NOT NULL,
        oidc_subject text NOT NULL,
        name text NOT NULL,
        email text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (oidc_issuer, oidc_subject)
      );
      CREATE TABLE ${schema}.rooms (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        location text NOT NULL,
        capacity integer NOT NULL CHECK (capacity > 0),
        description text,
        equipment text[] NOT NULL DEFAULT '{}',
        archived boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE ${schema}.occupancies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id uuid NOT NULL REFERENCES ${schema}.rooms(id),
        owner_id uuid REFERENCES ${schema}.users(id),
        kind text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL,
        title text NOT NULL,
        description text,
        cancelled_by uuid REFERENCES ${schema}.users(id),
        cancellation_reason text,
        cancelled_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (starts_at < ends_at),
        CHECK ((kind = 'booking' AND owner_id IS NOT NULL) OR (kind = 'maintenance' AND owner_id IS NULL)),
        CHECK (
          (status = 'active' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL)
          OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
        ),
        CONSTRAINT occupancies_no_overlap EXCLUDE USING gist (
          room_id WITH =,
          tstzrange(starts_at, ends_at, '[)') WITH &&
        ) WHERE (status = 'active')
      );
      CREATE INDEX occupancy_room_interval ON ${schema}.occupancies (room_id, starts_at);
      CREATE INDEX booking_owner_history ON ${schema}.occupancies (owner_id, starts_at DESC) WHERE kind = 'booking';
      CREATE TABLE ${schema}.booking_idempotency (
        user_id uuid NOT NULL REFERENCES ${schema}.users(id),
        request_key text NOT NULL,
        fingerprint text NOT NULL,
        outcome jsonb,
        PRIMARY KEY (user_id, request_key)
      );
      CREATE TABLE ${schema}.notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES ${schema}.users(id),
        booking_id uuid NOT NULL REFERENCES ${schema}.occupancies(id),
        type text NOT NULL CHECK (type IN ('booking_created', 'booking_updated', 'booking_cancelled', 'booking_reminder')),
        event_key text NOT NULL UNIQUE,
        title text NOT NULL,
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX notification_inbox ON ${schema}.notifications (user_id, created_at DESC);
      CREATE TABLE ${schema}.reminder_jobs (
        booking_id uuid PRIMARY KEY REFERENCES ${schema}.occupancies(id),
        due_at timestamptz NOT NULL,
        delivered_at timestamptz
      );
      CREATE INDEX pending_reminders ON ${schema}.reminder_jobs (due_at) WHERE delivered_at IS NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = queryRunner.connection.driver.escape(queryRunner.connection.driver.schema ?? 'public');
    await queryRunner.query(`
      DROP TABLE ${schema}.reminder_jobs, ${schema}.notifications, ${schema}.booking_idempotency,
        ${schema}.occupancies, ${schema}.rooms, ${schema}.users;
    `);
  }
}
