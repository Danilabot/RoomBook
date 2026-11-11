import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { requireAdmin, type Actor } from './actor.js';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user?: Actor }>();
    if (!user) throw new UnauthorizedException();
    requireAdmin(user);
    return true;
  }
}
