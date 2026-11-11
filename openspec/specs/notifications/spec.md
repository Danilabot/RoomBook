# notifications Specification

## Purpose
Keep employees informed about reservation changes and deliver reliable reminders before their meetings.

## Requirements

### Requirement: Durable booking notifications
The system SHALL store per-user in-app notifications for booking creation, updates and cancellation atomically with the corresponding mutation. Users SHALL read only their own inbox and mark their notifications read.
#### Scenario: Another user reads a notification
- **WHEN** an employee attempts to mark another user's notification read
- **THEN** access is denied without modifying it

### Requirement: Reminder delivery
The system SHALL schedule reminders thirty minutes before the booking starts, claim jobs with database locks and deduplicate delivery. Cancellation SHALL remove pending reminder work; a time change SHALL reschedule it.
#### Scenario: Worker fails
- **WHEN** a reminder transaction fails
- **THEN** the booking persists and the reminder remains retryable
#### Scenario: Concurrent workers
- **WHEN** two workers process the same due reminder
- **THEN** the inbox receives one reminder
#### Scenario: Cancellation during delivery
- **WHEN** cancellation runs concurrently with reminder delivery
- **THEN** operations complete without a database lock cycle and cancellation retains booking history
