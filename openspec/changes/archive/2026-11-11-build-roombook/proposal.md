# Proposal
## Why
Build a complete learning application for meeting-room reservations, extending the established NestJS and Keycloak architecture with concurrent booking rules.
## What Changes
- Room catalogue, equipment filters, availability calendar and employee reservations.
- Employee/admin authorization through Keycloak and server-side encrypted sessions.
- PostgreSQL-enforced non-overlap, idempotent booking and retained cancellation history.
- Maintenance blocks, in-app notifications, durable reminders, React UI and Compose deployment.
## Capabilities
### New Capabilities
- room-booking: Rooms, reservation lifecycle, maintenance and privacy.
- user-auth: Keycloak login, server sessions and roles.
- notifications: Durable in-app notifications and reminders.
- deployment: Reproducible Compose deployment and verification.
### Modified Capabilities
None.
## Impact
New standalone repository. NestJS, TypeORM, PostgreSQL, React, Nginx and Keycloak. No modification of notes-api or paid resources.
