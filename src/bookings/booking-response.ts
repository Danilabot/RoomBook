import type { Occupancy } from './occupancy.entity.js';

export function bookingResponse(booking: Occupancy) {
  return {
    id: booking.id,
    roomId: booking.roomId,
    ownerId: booking.ownerId,
    kind: booking.kind,
    status: booking.status,
    start: booking.start.toISOString(),
    end: booking.end.toISOString(),
    title: booking.title,
    description: booking.description,
    cancelledBy: booking.cancelledBy,
    cancellationReason: booking.cancellationReason,
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
  };
}

export type BookingResponse = ReturnType<typeof bookingResponse>;
