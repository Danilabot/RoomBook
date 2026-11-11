import { Inject, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AuthSessions, type Principal, type WriteProof } from './auth-sessions.js';
import { AUTH_SETTINGS, type AuthSettings } from './auth-settings.js';
import { browserCookieName, readCookie, SESSION_COOKIE } from './session-secrets.js';

const PUBLIC = Symbol('public route');
export const PublicRoute = () => SetMetadata(PUBLIC, true);
export type AuthenticatedRequest = Request & { user: Principal };

export function writeProof(request: Request): WriteProof {
  return { origin: request.headers.origin, token: request.headers['x-csrf-token'] };
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: AuthSessions,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    http.getResponse<Response>().set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const proof = ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? undefined : writeProof(request);
    const cookie = readCookie(request.headers.cookie, browserCookieName(SESSION_COOKIE, this.settings.localHttp));
    request.user = await this.sessions.authenticate(cookie, proof);
    return true;
  }
}
