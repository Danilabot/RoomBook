import { Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { AUTH_SETTINGS, LOGIN_CALLBACK, LOGOUT_CALLBACK, type AuthSettings } from './auth-settings.js';
import { AuthSessions } from './auth-sessions.js';
import { PublicRoute, SESSION_COOKIE, writeProof, type AuthenticatedRequest } from './session.guard.js';
import { readCookie } from './session-secrets.js';

const LOGIN_COOKIE = 'roombook_login';
const LOGOUT_COOKIE = 'roombook_logout';
const API_PATH = '/api';
const ATTEMPT_MS = 5 * 60_000;
const SESSION_MS = 8 * 60 * 60_000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly sessions: AuthSessions,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
  ) {}

  private cookieOptions(path: string): CookieOptions {
    return { path, httpOnly: true, sameSite: 'lax', secure: !this.settings.localHttp };
  }

  @PublicRoute()
  @Get('login')
  async login(@Res() response: Response): Promise<void> {
    const { url, binding } = await this.sessions.startLogin();
    response.cookie(LOGIN_COOKIE, binding, { ...this.cookieOptions(LOGIN_CALLBACK), maxAge: ATTEMPT_MS });
    response.redirect(url.href);
  }

  @PublicRoute()
  @Get('callback')
  async callback(@Req() request: Request, @Res() response: Response): Promise<void> {
    const url = new URL(this.settings.origin + LOGIN_CALLBACK);
    const queryStart = request.originalUrl.indexOf('?');
    if (queryStart !== -1) url.search = request.originalUrl.slice(queryStart);
    const session = await this.sessions.finishLogin(url,
      readCookie(request.headers.cookie, LOGIN_COOKIE), readCookie(request.headers.cookie, SESSION_COOKIE));
    response.clearCookie(LOGIN_COOKIE, this.cookieOptions(LOGIN_CALLBACK));
    response.cookie(SESSION_COOKIE, session, { ...this.cookieOptions(API_PATH), maxAge: SESSION_MS });
    response.redirect(this.settings.origin + '/');
  }

  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    const { id, email, roles } = request.user;
    return { id, email, roles };
  }

  @Get('csrf')
  csrf(@Req() request: AuthenticatedRequest) {
    return { csrfToken: request.user.csrf };
  }

  @PublicRoute()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.sessions.logout(readCookie(request.headers.cookie, SESSION_COOKIE), writeProof(request));
    response.clearCookie(SESSION_COOKIE, this.cookieOptions(API_PATH));
    if (result.url && result.binding) {
      response.cookie(LOGOUT_COOKIE, result.binding, { ...this.cookieOptions(LOGOUT_CALLBACK), maxAge: ATTEMPT_MS });
      return { localLoggedOut: true, ssoStatus: 'pending', logoutUrl: result.url.href };
    }
    return { localLoggedOut: true, ssoStatus: 'unavailable' };
  }

  @PublicRoute()
  @Get('logout/callback')
  async logoutCallback(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.sessions.finishLogout(request.query.state, readCookie(request.headers.cookie, LOGOUT_COOKIE));
    response.clearCookie(LOGOUT_COOKIE, this.cookieOptions(LOGOUT_CALLBACK));
    response.redirect(this.settings.origin + '/');
  }
}
