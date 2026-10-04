/**
 * The shared auth protocol. `portal_ui_standards.md` section 4.3.
 *
 * Implemented against the shape predictive already uses, since it is the most
 * complete of the three. Portals whose backend lacks an endpoint get a
 * capability flag rather than a different client:
 *
 * | Endpoint                  | causal | forecasting | predictive |
 * | ------------------------- | ------ | ----------- | ---------- |
 * | `/auth/frictionless-login`| yes    | yes         | yes        |
 * | `/auth/config`            | no     | no          | yes        |
 * | `/auth/logout`            | no     | no          | yes        |
 * | `/me`                     | no     | no          | yes        |
 */

import type { ApiClient } from './apiClient.js';
import { PortalError } from './errors.js';

export const DEFAULT_ROLES = ['viewer', 'analyst', 'reviewer', 'admin'] as const;
export type Role = (typeof DEFAULT_ROLES)[number];

export interface AuthCapabilities {
  /** `GET /auth/config` — whether browser-workspace login is offered. */
  config: boolean;
  /** `POST /auth/logout` — server-side session revocation. */
  logout: boolean;
  /** `GET /me` — identity for a token. */
  me: boolean;
}

/** Every platform implements login; the rest are opt-in. */
export const BASE_CAPABILITIES: AuthCapabilities = {
  config: false,
  logout: false,
  me: false,
};

export interface AuthConfig {
  mode: string;
  enabled: boolean;
  email_verified: boolean;
}

export interface LoginRequest {
  email: string;
  /**
   * The browser-local workspace recovery key, where the platform uses one.
   * Omitted entirely for a backend that takes an email alone (forecasting).
   */
  workspaceKey?: string;
}

export interface LoginResult {
  token: string;
  tenant_id?: string;
  email?: string;
  role?: string;
  expires_in?: number;
  email_verified?: boolean;
}

export interface Identity {
  tenant: string;
  actor: string;
  role: string;
  workspace_kind?: string;
  session_id?: string;
}

export interface AuthClientOptions {
  capabilities?: Partial<AuthCapabilities>;
  /** Accepted `/me` roles. Defaults to the four predictive defines. */
  roles?: readonly string[];
  /** Path prefix for the auth endpoints. */
  prefix?: string;
}

export class AuthClient {
  readonly capabilities: AuthCapabilities;
  private readonly client: ApiClient;
  private readonly roles: readonly string[];
  private readonly prefix: string;

  constructor(client: ApiClient, options: AuthClientOptions = {}) {
    this.client = client;
    this.capabilities = { ...BASE_CAPABILITIES, ...options.capabilities };
    this.roles = options.roles ?? DEFAULT_ROLES;
    this.prefix = options.prefix ?? '/auth';
  }

  /**
   * `GET /auth/config`.
   *
   * Validates that `enabled` is a boolean, because a portal served from an
   * address that is not the API answers this path with HTML. Reading that as
   * "login disabled" would hide the real problem from the operator.
   */
  async loadConfig(): Promise<AuthConfig> {
    this.require('config');
    const payload = await this.client.request<Partial<AuthConfig>>(
      `${this.prefix}/config`,
      { authMode: 'none' },
    );
    if (typeof payload.enabled !== 'boolean') {
      throw new PortalError('invalid-response', {
        path: `${this.prefix}/config`,
        message:
          'The workspace service is not reachable at this address. Check the configured API address, then retry.',
      });
    }
    return {
      mode: typeof payload.mode === 'string' ? payload.mode : 'unknown',
      enabled: payload.enabled,
      email_verified: payload.email_verified === true,
    };
  }

  /**
   * `POST /auth/frictionless-login`. Stores the returned bearer token.
   *
   * `workspace_key` is only sent when the caller supplies one: predictive
   * requires it, forecasting's endpoint takes an email alone and rejects extra
   * fields.
   */
  async frictionlessLogin(request: LoginRequest): Promise<LoginResult> {
    const body: Record<string, string> = { email: request.email };
    if (request.workspaceKey) body.workspace_key = request.workspaceKey;

    const result = await this.client.request<Partial<LoginResult>>(
      `${this.prefix}/frictionless-login`,
      { method: 'POST', body, authMode: 'none' },
    );
    if (typeof result.token !== 'string' || !result.token) {
      throw new PortalError('invalid-response', {
        path: `${this.prefix}/frictionless-login`,
        message:
          'The service accepted the connection but returned no access token. Retry, then check the server logs.',
      });
    }
    this.client.setToken(result.token);
    return result as LoginResult;
  }

  /**
   * `GET /me`, with the identity shape validated.
   *
   * A malformed identity must not replace a working session, so this throws
   * rather than returning a partial object; callers set state only on success.
   */
  async identity(token?: string): Promise<Identity> {
    this.require('me');
    const payload = await this.client.request<Partial<Identity>>('/me', { token });
    const valid =
      typeof payload.tenant === 'string' &&
      payload.tenant !== '' &&
      typeof payload.actor === 'string' &&
      typeof payload.role === 'string' &&
      this.roles.includes(payload.role);
    if (!valid) {
      throw new PortalError('invalid-response', {
        path: '/me',
        message:
          'The workspace service returned an identity this portal could not read. The current workspace was preserved.',
      });
    }
    return payload as Identity;
  }

  /**
   * Ends the session.
   *
   * The stored token is always cleared, even when the server call fails or the
   * platform has no `/auth/logout`: disconnecting must never leave a portal
   * holding a credential it has told the operator it discarded. The server
   * outcome is reported in the return value instead of thrown.
   */
  async logout(token?: string): Promise<{ revoked: boolean; reason?: string }> {
    const bearer = token ?? this.client.token();
    try {
      if (!this.capabilities.logout) {
        return {
          revoked: false,
          reason: 'This platform has no server-side logout; the token was discarded locally.',
        };
      }
      if (!bearer) return { revoked: false, reason: 'No session was connected.' };
      await this.client.request(`${this.prefix}/logout`, {
        method: 'POST',
        body: {},
        token: bearer,
      });
      return { revoked: true };
    } catch (error) {
      return {
        revoked: false,
        reason: error instanceof Error ? error.message : undefined,
      };
    } finally {
      this.client.clearToken();
    }
  }

  private require(capability: keyof AuthCapabilities): void {
    if (this.capabilities[capability]) return;
    throw new PortalError('unsupported', {
      message: `The ${this.client.platform} platform does not provide ${capability === 'me' ? '/me' : `${this.prefix}/${capability}`}.`,
    });
  }
}
