## Why

RoomBook's standalone realm cannot authenticate accounts registered in the Notes Keycloak realm, including users who already sign in through Google.

## What Changes

- Use the existing Notes realm for local RoomBook sign-in by default, with standalone demo mode available separately.
- Provision a separate RoomBook OIDC client, API audience and resource roles without changing Notes clients or the Google provider.
- Preserve RoomBook application data and reject sessions issued by another realm.

## Capabilities

### New Capabilities

### Modified Capabilities

- `user-auth`: Accept Notes realm users and bind each authentication session and pending exchange to the configured issuer.
- `deployment`: Add an idempotent shared realm setup and retain standalone local deployment.

## Impact

RoomBook Compose, realm bootstrap and OIDC session validation. The Notes checkout and database ownership stay with Notes. The shared setup backs up Keycloak before provisioning.
