import { IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { IfProvided, Trim } from '../validation.js';

export class TimeWindow {
  @IsString()
  @MaxLength(35)
  start!: string;

  @IsString()
  @MaxLength(35)
  end!: string;
}

export class CreateBooking extends TimeWindow {
  @IsUUID()
  roomId!: string;

  @Trim()
  @IsString()
  @Length(1, 120)
  title!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(3000)
  description?: string | null;
}

export class UpdateBooking {
  @IfProvided()
  @IsUUID()
  roomId?: string;

  @IfProvided()
  @IsString()
  @MaxLength(35)
  start?: string;

  @IfProvided()
  @IsString()
  @MaxLength(35)
  end?: string;

  @IfProvided()
  @Trim()
  @IsString()
  @Length(1, 120)
  title?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(3000)
  description?: string | null;
}

export class CancellationReason {
  @Trim()
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class CreateMaintenance extends TimeWindow {
  @Trim()
  @IsString()
  @Length(1, 500)
  reason!: string;
}
