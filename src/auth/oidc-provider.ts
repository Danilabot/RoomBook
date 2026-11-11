import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, customFetch, errors, jwtVerify } from 'jose';
import * as oidc from 'openid-client';
import {
  AUTH_SETTINGS, LOGIN_CALLBACK, LOGOUT_CALLBACK, OIDC_AUDIENCE, OIDC_CLIENT_ID, type AuthSettings,
} from './auth-settings.js';
import type { Role } from './actor.js';

export interface LoginAttempt {
  verifier: string;
  nonce: string;
}

export interface VerifiedTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: Date;
  roles: Role[];
}

interface VerifiedLogin extends VerifiedTokens {
  subject: string;
  sid: string;
  name: string;
  email: string | null;
}

function providerUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException('Identity provider temporarily unavailable');
}

@Injectable()
export class OidcProvider {
  private configuration?: Promise<oidc.Configuration>;
  private keys?: ReturnType<typeof createRemoteJWKSet>;
  private readonly publicOrigin: string;

  constructor(@Inject(AUTH_SETTINGS) private readonly settings: AuthSettings) {
    this.publicOrigin = new URL(settings.issuer).origin;
  }

  private sameOrigin(value: string): URL {
    const url = new URL(value);
    if (url.origin !== this.publicOrigin || url.username || url.password || url.hash) throw providerUnavailable();
    return url;
  }

  // Discovery and browser redirects retain the public issuer. Only server traffic is rewritten.
  private readonly fetch = async (input: string, options: RequestInit | oidc.CustomFetchOptions): Promise<Response> => {
    const endpoint = this.sameOrigin(input);
    const destination = this.settings.internalOrigin
      ? this.settings.internalOrigin + endpoint.pathname + endpoint.search
      : endpoint.href;
    try {
      const body = options.body instanceof Uint8Array ? new Uint8Array(options.body) : options.body;
      const response = await fetch(destination, { ...options, body, redirect: 'manual' });
      if (response.status >= 500 || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel();
        throw providerUnavailable();
      }
      return response;
    } catch {
      throw providerUnavailable();
    }
  };

  private async discover(): Promise<oidc.Configuration> {
    try {
      const allowHttp = this.publicOrigin.startsWith('http:');
      const configuration = await oidc.discovery(
        new URL(this.settings.issuer),
        OIDC_CLIENT_ID,
        { id_token_signed_response_alg: 'RS256' },
        oidc.ClientSecretPost(this.settings.clientSecret),
        {
          timeout: 5,
          [oidc.customFetch]: this.fetch,
          execute: allowHttp ? [oidc.allowInsecureRequests] : undefined,
        },
      );
      const metadata = configuration.serverMetadata();
      for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
        if (!endpoint) throw providerUnavailable();
        this.sameOrigin(endpoint);
      }
      oidc.enableNonRepudiationChecks(configuration);
      return configuration;
    } catch {
      throw providerUnavailable();
    }
  }

  private client(): Promise<oidc.Configuration> {
    return this.configuration ??= this.discover().catch((error: unknown) => {
      this.configuration = undefined;
      throw error;
    });
  }

  async authorizationUrl(state: string, attempt: LoginAttempt): Promise<URL> {
    return oidc.buildAuthorizationUrl(await this.client(), {
      redirect_uri: this.settings.origin + LOGIN_CALLBACK,
      scope: 'openid profile email',
      response_type: 'code',
      code_challenge: await oidc.calculatePKCECodeChallenge(attempt.verifier),
      code_challenge_method: 'S256',
      state,
      nonce: attempt.nonce,
    });
  }

  private async verifyAccess(
    client: oidc.Configuration, token: string, subject: string, sid: string,
  ): Promise<Pick<VerifiedTokens, 'roles' | 'expiresAt'>> {
    this.keys ??= createRemoteJWKSet(this.sameOrigin(client.serverMetadata().jwks_uri!), {
      timeoutDuration: 5000, [customFetch]: this.fetch,
    });
    const { payload } = await jwtVerify(token, this.keys, {
      algorithms: ['RS256'], issuer: this.settings.issuer, audience: OIDC_AUDIENCE,
      requiredClaims: ['sub', 'sid', 'iat', 'exp'],
    });
    const { iat, exp } = payload;
    if (
      payload.sub !== subject || payload.sid !== sid || typeof iat !== 'number' || typeof exp !== 'number' ||
      exp <= iat || exp - iat > 300 || iat > Math.floor(Date.now() / 1000)
    ) throw new UnauthorizedException();
    const resources = payload.resource_access as { [OIDC_AUDIENCE]?: { roles?: unknown } } | undefined;
    const assigned = resources?.[OIDC_AUDIENCE]?.roles;
    const roles: Role[] = Array.isArray(assigned)
      ? [...new Set(assigned.filter((role): role is Role => role === 'employee' || role === 'admin'))]
      : [];
    return { roles, expiresAt: new Date(exp * 1000) };
  }

  async exchange(url: URL, state: string, attempt: LoginAttempt): Promise<VerifiedLogin> {
    const client = await this.client();
    try {
      const tokens = await oidc.authorizationCodeGrant(client, url, {
        expectedState: state, expectedNonce: attempt.nonce, pkceCodeVerifier: attempt.verifier, idTokenExpected: true,
      });
      const identity = tokens.claims();
      if (
        !identity?.sub || typeof identity.sid !== 'string' || !identity.sid ||
        !tokens.id_token || !tokens.refresh_token || tokens.token_type.toLowerCase() !== 'bearer'
      ) throw new UnauthorizedException();
      const access = await this.verifyAccess(client, tokens.access_token, identity.sub, identity.sid);
      const email = typeof identity.email === 'string' && identity.email ? identity.email : null;
      const name = typeof identity.name === 'string' && identity.name ? identity.name : email ?? identity.sub;
      return {
        ...access, subject: identity.sub, sid: identity.sid, email, name,
        accessToken: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token,
      };
    } catch (error) {
      throw this.tokenError(error);
    }
  }

  async refresh(previous: VerifiedTokens, subject: string, sid: string): Promise<VerifiedTokens> {
    const client = await this.client();
    try {
      const tokens = await oidc.refreshTokenGrant(client, previous.refreshToken);
      const identity = tokens.claims();
      if (
        tokens.token_type.toLowerCase() !== 'bearer' ||
        (identity && (identity.sub !== subject || (identity.sid !== undefined && identity.sid !== sid)))
      ) throw new UnauthorizedException();
      const access = await this.verifyAccess(client, tokens.access_token, subject, sid);
      return {
        ...access, accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? previous.refreshToken, idToken: tokens.id_token ?? previous.idToken,
      };
    } catch (error) {
      throw this.tokenError(error);
    }
  }

  private tokenError(error: unknown): UnauthorizedException | ServiceUnavailableException {
    if (
      error instanceof ServiceUnavailableException || error instanceof errors.JWKSTimeout ||
      (error instanceof oidc.ClientError && ['OAUTH_TIMEOUT', 'OAUTH_ABORT'].includes(error.code ?? '')) ||
      (error instanceof oidc.ResponseBodyError && error.error !== 'invalid_grant') ||
      (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
    ) return providerUnavailable();
    if (error instanceof Error && error.cause instanceof ServiceUnavailableException) return providerUnavailable();
    return new UnauthorizedException('Invalid identity provider credentials');
  }

  async logoutUrl(state: string): Promise<URL> {
    // Fresh discovery detects provider failure after the local session has already been revoked.
    const client = await this.discover();
    const endpoint = client.serverMetadata().end_session_endpoint;
    if (!endpoint) throw providerUnavailable();
    this.sameOrigin(endpoint);
    return oidc.buildEndSessionUrl(client, {
      client_id: OIDC_CLIENT_ID, post_logout_redirect_uri: this.settings.origin + LOGOUT_CALLBACK, state,
    });
  }
}
