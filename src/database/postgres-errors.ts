import { QueryFailedError } from 'typeorm';

export function isOccupancyConflict(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const details = error.driverError as { code?: string; constraint?: string };
  return details.code === '23P01' && details.constraint === 'occupancies_no_overlap';
}
