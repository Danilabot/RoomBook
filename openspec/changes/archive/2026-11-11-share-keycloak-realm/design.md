## Context

Notes owns the existing Keycloak realm, Google broker and user records. RoomBook owns bookings, an independent database, browser sessions and application roles.

## Goals / Non-Goals

- Share SSO through one existing realm and keep independent app clients and sessions.
- Grant the RoomBook employee role by default. Grant RoomBook admin only through explicit Keycloak role mapping.
- Keep standalone demo available and preserve both databases when switching.
- Preserve issuer and subject identity. Automatic account linking by email is out of scope.

## Decisions

The Notes Keycloak container and RoomBook API use a dedicated external network. Only the existing Keycloak service connects from the Notes stack. Its dedicated alias is allowlisted for loopback development. Public redirects retain the Notes issuer.

Bootstrap uses the Keycloak Admin API and a database backup. It checks the existing realm, configures RoomBook-owned clients and roles, and grants employee access without modifying Notes clients or provider settings. RoomBook sessions are resolved only for the active issuer. Pending state is issuer-bound cryptographically.

## Risks / Trade-offs

Existing standalone bookings stay attached to their original issuer and subject. Switching back to standalone mode exposes those bookings to their original owners. The two local deployment modes use the same RoomBook port.
