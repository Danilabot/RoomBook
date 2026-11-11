## ADDED Requirements

### Requirement: Shared realm and issuer isolation
RoomBook SHALL support the existing Notes Keycloak realm with a distinct confidential client and RoomBook-specific audience and roles. Existing and new realm users SHALL receive employee access. Administrator access SHALL require explicit assignment. RoomBook SHALL reject sessions and pending exchanges from another issuer and SHALL identify accounts by issuer and subject.

#### Scenario: Existing Notes account
- **WHEN** a Notes user authenticates through the shared realm
- **THEN** RoomBook accepts the verified identity with its RoomBook employee role

#### Scenario: Old issuer session
- **WHEN** a standalone cookie is submitted while RoomBook uses the shared issuer
- **THEN** the cookie cannot authenticate and stored booking ownership remains intact
