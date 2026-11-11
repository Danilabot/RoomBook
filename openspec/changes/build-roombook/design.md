# Design
## Architecture
Modular NestJS monolith, TypeORM PostgreSQL migrations, React SPA behind Nginx. Standalone Compose project on port 3100, Keycloak 8180; do not interfere with notes-api. Reuse audited patterns from notes-api as source only, never its environment files, credentials or database. Fresh Keycloak realm roombook, employee/admin roles and local demo users; optional Google provider configured by operator.
## Booking rules
Rooms have name, location, capacity, description, equipment and archived flag. Office timezone Europe/Moscow, office hours 08:00–20:00 daily, reservation maximum 8 hours. Store timestamptz; half-open ranges [start,end). Active bookings and maintenance share exclusion-constrained occupancy table using btree_gist. Serialize archive/create via room row lock. Updates revalidate constraints. Owners manage future reservations; admin cancellations require reason. Public busy intervals omit private title/description and identity. Maintenance conflict returns 409 with admin-visible conflicts, never cancels silently.
## Reliability
Idempotency-Key scoped to user, normalized payload fingerprint and persisted outcome in same transaction; same-key different body 409. Notifications and reminder schedule committed transactionally. Worker claims due jobs with SKIP LOCKED, unique event keys prevent duplicate inbox items. Cancellation invalidates pending reminder. UI preserves failed drafts.
## Auth
OIDC authorization code + PKCE/state/nonce, HttpOnly opaque session cookie, encrypted server tokens, Origin/CSRF writes, refresh serialization and local-first logout. Google credentials never committed. Session data shared in PostgreSQL.
## Alternatives and decisions
Use modular monolith rather than microservices to keep deployment and transactions manageable. PostgreSQL job queue rather than additional Redis for this bounded workload. Shared Keycloak would enable cross-app SSO but standalone instance avoids altering existing notes deployment; document optional federation setup.
## Verification
Real PostgreSQL integration tests for simultaneous overlap and idempotency; ownership/admin/privacy, timezone boundaries, migration replay, cancellation and reminders. Browser smoke plus full Compose clean startup. Requirements remain open until verified.
