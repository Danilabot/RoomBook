# room-booking Specification

## Purpose
Allow employees to find available rooms and safely manage reservations while administrators manage rooms and maintenance.

## Requirements

### Requirement: Catalogue and privacy
The system SHALL list active rooms with capacity, equipment and availability filters. Busy intervals SHALL omit private meeting fields and owner identities.
#### Scenario: Another employee views availability
- **WHEN** an employee requests another employee's occupied interval
- **THEN** only start, end and occupancy kind are returned

### Requirement: Reservation lifecycle
Employees SHALL create and modify their future reservations and cancel them while retaining history. The server SHALL derive owner from verified session. Administrators SHALL cancel any reservation only with a reason.
#### Scenario: Foreign booking modification
- **WHEN** an employee changes another employee's booking
- **THEN** the request returns 404 and data remains unchanged

### Requirement: Non-overlap
PostgreSQL SHALL prevent overlapping active occupancy for a room using half-open intervals. Office timezone is Europe/Moscow with hours 08:00–20:00 daily and maximum reservation duration 8 hours.
#### Scenario: Concurrent requests
- **WHEN** two users simultaneously book overlapping intervals in one room
- **THEN** only one succeeds and the other receives 409
#### Scenario: Adjacent intervals
- **WHEN** one booking ends exactly when another starts
- **THEN** both can be stored

### Requirement: Idempotency
Creation SHALL accept a user-scoped Idempotency-Key and persist the outcome atomically with the booking.
#### Scenario: Lost response retry
- **WHEN** the same user repeats a key with the same normalized payload
- **THEN** the original result is returned without a duplicate booking
#### Scenario: Key reused with different payload
- **WHEN** the same key is submitted with a different payload
- **THEN** the request returns 409

### Requirement: Maintenance and archive
Administrators SHALL archive rooms while retaining history and block intervals for maintenance without silently canceling existing bookings.
#### Scenario: Maintenance conflicts
- **WHEN** maintenance overlaps an active booking
- **THEN** creation fails with 409 and displays conflicts to the administrator
