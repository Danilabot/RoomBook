# RoomBook Implementation Plan
Spec: design.md and specs/*/spec.md. All implementation uses this isolated checkout.
- [x] 1. Establish NestJS/TypeORM foundation, migration and real PostgreSQL booking domain tests, implement catalogue, overlap protection, ownership, maintenance, idempotency and notifications.
- [x] 2. Integrate Keycloak OIDC sessions, CSRF, roles and logout; test unauthorized and forbidden access.
- [x] 3. Build React catalogue, calendar, booking editor, personal history, notifications and admin screens; verify UI workflows.
- [x] 4. Add standalone Compose, demo realm/data, migrations and reminder worker; verify clean startup and persistence.
- [x] 5. Complete security and concurrency checks, README, OpenSpec sync/archive; commit and push verified result.
