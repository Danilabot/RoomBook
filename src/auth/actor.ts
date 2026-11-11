import { createParamDecorator, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';

export type Role = 'employee' | 'admin';

export interface Actor {
  id: string;
  roles: Role[];
}

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor => {
    const { user } = context.switchToHttp().getRequest<{ user?: Actor }>();
    if (!user) throw new UnauthorizedException();
    if (!user.roles.includes('employee') && !user.roles.includes('admin')) throw new ForbiddenException();
    return user;
  },
);

export function requireAdmin(actor: Actor): void {
  if (!actor.roles.includes('admin')) throw new ForbiddenException();
}
