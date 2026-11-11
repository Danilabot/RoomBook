import { Transform } from 'class-transformer';
import { ValidateIf } from 'class-validator';

export function Trim(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value);
}

export function IfProvided(): PropertyDecorator {
  return ValidateIf((_target: unknown, value: unknown) => value !== undefined);
}
