## ADDED Requirements

### Requirement: Shared local deployment
The default local deployment SHALL connect to the Notes Keycloak realm without replacing its existing clients, users or identity providers. Provisioning SHALL back up the Keycloak database before mutation and be safe to rerun. Standalone deployment SHALL remain available.

#### Scenario: Shared configuration is reapplied
- **WHEN** provisioning runs again against the existing Notes realm
- **THEN** Notes keeps its existing client and Google configuration and RoomBook retains its separate client and roles
