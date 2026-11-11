# user-auth Specification

## Purpose
Identify employees through Keycloak and protect application operations with verified server sessions and role-based access.

## Requirements

### Requirement: Verified OIDC login
The system SHALL use authorization-code flow with PKCE S256, state, nonce and cryptographic issuer/audience validation. Browser-bound attempts SHALL be consumed once and expire after five minutes.
#### Scenario: Replayed callback
- **WHEN** a callback is repeated after consumption
- **THEN** no new session is created

### Requirement: Server sessions
Tokens SHALL be encrypted server-side using AES-256-GCM with an environment key. Browser cookies SHALL contain opaque identifiers and be HttpOnly with SameSite=Lax and Secure outside local development. Local sessions SHALL have 30-minute idle and 8-hour absolute limits.
#### Scenario: Expired access token
- **WHEN** a valid session needs new access credentials
- **THEN** refresh is serialized and verified replacement tokens and roles are saved

### Requirement: Authorization and CSRF
The server SHALL enforce employee/admin roles and validate Origin plus a session-bound CSRF token on mutations. Unauthenticated requests SHALL return 401; insufficient permissions SHALL return 403.
#### Scenario: Missing CSRF
- **WHEN** an authenticated browser mutates a resource without the matching CSRF token
- **THEN** the server returns 403 without mutation

### Requirement: Logout and provider failures
Logout SHALL invalidate local sessions before attempting provider logout. Provider unavailability SHALL not be reported as an incorrect password.
#### Scenario: Provider fails during logout
- **WHEN** Keycloak cannot be reached after local logout
- **THEN** the old local cookie remains invalid and the UI explains SSO logout was incomplete

### Requirement: Shared realm and issuer isolation
RoomBook SHALL support the existing Notes Keycloak realm with a distinct confidential client and RoomBook-specific audience and roles. Existing and new realm users SHALL receive employee access. Administrator access SHALL require explicit assignment. RoomBook SHALL reject sessions and pending exchanges from another issuer and SHALL identify accounts by issuer and subject.

#### Scenario: Existing Notes account
- **WHEN** a Notes user authenticates through the shared realm
- **THEN** RoomBook accepts the verified identity with its RoomBook employee role

#### Scenario: Old issuer session
- **WHEN** a standalone cookie is submitted while RoomBook uses the shared issuer
- **THEN** the cookie cannot authenticate and stored booking ownership remains intact
