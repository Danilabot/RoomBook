# Verification — 2026-11-11

- Backend:25 tests passed against a new PostgreSQL18 database, including concurrency, idempotency, privacy, roles, session expiration, CSRF, refresh rotation and migration replay.
- Frontend:14 tests passed; production build succeeded. Mocked Chromium checked desktop/mobile360px and Moscow display with a Los Angeles browser timezone.
- Complete Compose: clean startup, both migrations, repeatable demo seed, real Keycloak employee/admin login/logout, booking CRUD, administrator maintenance and cancellation, real refresh rotation, unauthorized401/forbidden403, failed reminder retry without duplication, callback log exclusion.
- Persistence: compose down/up without deleting volumes retained identities, room, booking and maintenance history. Both roles signed in again successfully.
- Runtime npm audits:0 known vulnerabilities for API and frontend at verification time.
- Independent domain/auth/UI/deployment reviews and final whole-project review approved after targeted fixes.

Google sign-in configuration is documented but not tested in this new realm. Local deployment uses HTTP on loopback; public TLS and high availability are not included. Vite emits non-blocking lucide-react module directive warnings.
