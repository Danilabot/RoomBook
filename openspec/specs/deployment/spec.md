# deployment Specification

## Purpose
Provide an isolated reproducible local deployment with persistent data and documented setup and verification.

## Requirements

### Requirement: deployment
The system SHALL provide standalone Docker Compose, migration-based schema, persistent volumes, automated tests, demo data and complete startup documentation.

#### Scenario: Verified operation
- **WHEN** the documented workflow is exercised
- **THEN** its specified behavior is verified by automated tests and documented smoke checks

### Requirement: Shared local deployment
The default local deployment SHALL connect to the Notes Keycloak realm without replacing its existing clients, users or identity providers. Provisioning SHALL back up the Keycloak database before mutation and be safe to rerun. Standalone deployment SHALL remain available.

#### Scenario: Shared configuration is reapplied
- **WHEN** provisioning runs again against the existing Notes realm
- **THEN** Notes keeps its existing client and Google configuration and RoomBook retains its separate client and roles
