import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { IfProvided, Trim } from '../validation.js';

function EquipmentList(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => Array.isArray(value)
    ? value.map((entry: unknown) => typeof entry === 'string' ? entry.trim() : entry)
    : value);
}

export class CreateRoom {
  @Trim()
  @IsString()
  @Length(1, 120)
  name!: string;

  @Trim()
  @IsString()
  @Length(1, 120)
  location!: string;

  @IsInt()
  @Min(1)
  @Max(10_000)
  capacity!: number;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(3000)
  description?: string | null;

  @EquipmentList()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  equipment!: string[];
}

export class UpdateRoom {
  @IfProvided()
  @Trim()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IfProvided()
  @Trim()
  @IsString()
  @Length(1, 120)
  location?: string;

  @IfProvided()
  @IsInt()
  @Min(1)
  @Max(10_000)
  capacity?: number;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(3000)
  description?: string | null;

  @IfProvided()
  @EquipmentList()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  equipment?: string[];

  @IfProvided()
  @IsBoolean()
  archived?: boolean;
}

export class RoomFilters {
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
  @MaxLength(120)
  search?: string;

  @IfProvided()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  minCapacity?: number;

  @IfProvided()
  @IsString()
  @MaxLength(4000)
  equipment?: string;

  @IfProvided()
  @Transform(({ value }: { value: unknown }) => value === 'true' || (value === 'false' ? false : value))
  @IsBoolean()
  includeArchived?: boolean;
}
