/**
 * Token and preference storage. `portal_ui_standards.md` section 4.2.
 *
 * One convention, in the kit, used by every portal:
 *
 * - Bearer tokens in `sessionStorage` under `scurve.<platform>.token`. A
 *   credential that outlives the browser session is a longer-lived secret than
 *   an operator portal needs.
 * - Durable non-secret preferences in `localStorage` under
 *   `scurve.<platform>.<key>`.
 * - Workspace recovery keys in `localStorage` under
 *   `scurve.<platform>.workspaceKeys`. They are browser-local and not
 *   recoverable anywhere else.
 *
 * Namespacing every key under `scurve.<platform>.` prevents collisions when
 * two portals are served from one origin and makes orphaned keys obvious.
 */

export const KEY_NAMESPACE = 'scurve';
export const TOKEN_KEY = 'token';
export const WORKSPACE_KEYS_KEY = 'workspaceKeys';

/** Where a legacy key lived before namespacing, so it can be found and moved. */
export type StorageArea = 'local' | 'session';

export interface LegacyKeyMigration {
  /** The pre-standard key name, e.g. `pml-token` or `forecasting_user_token`. */
  from: string;
  /** Which storage it lived in. */
  area: StorageArea;
  /**
   * The namespaced name to move it to, e.g. `token` or `email`. Omit to
   * delete the legacy entry without carrying it forward.
   */
  to?: string;
}

export interface TokenStoreOptions {
  /** Platform slug used in every key: `causal`, `forecasting`, `predictive`. */
  platform: string;
  /**
   * Bearer token keys to migrate from. The token always lands in
   * `sessionStorage`, whatever area it came from — that move is the deliberate
   * behaviour change section 4.2 describes for causal and forecasting.
   */
  legacyTokenKeys?: readonly (string | { from: string; area: StorageArea })[];
  /** Workspace-recovery-key entries to migrate from. */
  legacyWorkspaceKeys?: readonly (string | { from: string; area: StorageArea })[];
  /** Preference keys to migrate, named `{from, area, to}`. */
  legacyPrefKeys?: readonly LegacyKeyMigration[];
  /**
   * Legacy preference key prefixes to migrate wholesale. A key matching
   * `<prefix>` becomes `scurve.<platform>.<replacement><rest>`.
   */
  legacyPrefPrefixes?: readonly { from: string; to: string; area?: StorageArea }[];
}

function area(kind: StorageArea): Storage | null {
  try {
    const storage = kind === 'session' ? window.sessionStorage : window.localStorage;
    // Touching `length` surfaces a SecurityError in a blocked-cookie context
    // before any caller depends on the handle.
    void storage.length;
    return storage;
  } catch {
    return null;
  }
}

function read(kind: StorageArea, key: string): string {
  try {
    return area(kind)?.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(kind: StorageArea, key: string, value: string): void {
  try {
    area(kind)?.setItem(key, value);
  } catch {
    // Storage is full or blocked. A portal must stay usable without it; the
    // caller keeps its own in-memory copy for the life of the page.
  }
}

function remove(kind: StorageArea, key: string): void {
  try {
    area(kind)?.removeItem(key);
  } catch {
    // Same as `write`: nothing useful to tell an operator about this.
  }
}

function keysIn(kind: StorageArea): string[] {
  const storage = area(kind);
  if (!storage) return [];
  const found: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null) found.push(key);
    }
  } catch {
    return found;
  }
  return found;
}

function asMigration(
  entry: string | { from: string; area: StorageArea },
  fallbackArea: StorageArea,
): { from: string; area: StorageArea } {
  if (typeof entry === 'string') return { from: entry, area: fallbackArea };
  return entry;
}

/**
 * Namespaced access to the three storage categories in section 4.2.
 *
 * Construct one per portal and pass it to the API client; nothing else in a
 * portal should name a storage key directly.
 */
export class TokenStore {
  readonly platform: string;
  private readonly options: TokenStoreOptions;
  private migrated = false;

  constructor(options: TokenStoreOptions) {
    this.platform = options.platform;
    this.options = options;
  }

  /** `scurve.<platform>.<key>`. */
  key(name: string): string {
    return `${KEY_NAMESPACE}.${this.platform}.${name}`;
  }

  // --- bearer token (sessionStorage) ---------------------------------------

  readToken(): string {
    this.migrateLegacyKeys();
    return read('session', this.key(TOKEN_KEY));
  }

  writeToken(token: string): void {
    this.migrateLegacyKeys();
    if (!token) {
      this.clearToken();
      return;
    }
    write('session', this.key(TOKEN_KEY), token);
  }

  clearToken(): void {
    remove('session', this.key(TOKEN_KEY));
  }

  // --- durable preferences (localStorage) ---------------------------------

  readPref(name: string): string {
    this.migrateLegacyKeys();
    return read('local', this.key(name));
  }

  writePref(name: string, value: string): void {
    this.migrateLegacyKeys();
    if (value === '') {
      this.clearPref(name);
      return;
    }
    write('local', this.key(name), value);
  }

  clearPref(name: string): void {
    remove('local', this.key(name));
  }

  /** Preference names currently stored for this platform, without the prefix. */
  prefNames(): string[] {
    this.migrateLegacyKeys();
    const prefix = this.key('');
    return keysIn('local')
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }

  /** Drops every preference whose name matches, e.g. per-metric saved state. */
  clearPrefsMatching(matches: (name: string) => boolean): void {
    for (const name of this.prefNames()) {
      if (matches(name)) this.clearPref(name);
    }
  }

  /**
   * A preference scoped to the browser session rather than the browser.
   *
   * Section 4.2 names three categories; this is the narrow case of a
   * non-secret value that should not outlive the session either, such as a
   * demo workspace key that must not silently resurrect an old demo workspace.
   */
  readSessionPref(name: string): string {
    this.migrateLegacyKeys();
    return read('session', this.key(name));
  }

  writeSessionPref(name: string, value: string): void {
    this.migrateLegacyKeys();
    if (value === '') {
      remove('session', this.key(name));
      return;
    }
    write('session', this.key(name), value);
  }

  // --- workspace recovery keys (localStorage) -----------------------------

  /**
   * Browser-local workspace recovery keys, keyed by whatever the platform
   * identifies a workspace by (predictive uses the contact email).
   *
   * These are not recoverable anywhere else. Clearing browser storage loses
   * the workspace; the standard requires portals to say so plainly.
   */
  readWorkspaceKeys(): Record<string, string> {
    this.migrateLegacyKeys();
    const raw = read('local', this.key(WORKSPACE_KEYS_KEY));
    if (!raw) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        'Saved workspace access in this browser could not be read. Use an operator token to recover access.',
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') result[name] = value;
    }
    return result;
  }

  writeWorkspaceKeys(keys: Record<string, string>): void {
    this.migrateLegacyKeys();
    write('local', this.key(WORKSPACE_KEYS_KEY), JSON.stringify(keys));
  }

  /** Returns the existing recovery key for `name`, minting one if absent. */
  ensureWorkspaceKey(name: string, mint: () => string): string {
    const keys = this.readWorkspaceKeys();
    const existing = keys[name];
    if (existing) return existing;
    const minted = mint();
    this.writeWorkspaceKeys({ ...keys, [name]: minted });
    return minted;
  }

  hasWorkspaceKey(name: string): boolean {
    return Boolean(this.readWorkspaceKeys()[name]);
  }

  // --- migration -----------------------------------------------------------

  /**
   * Moves pre-standard keys into the namespace, once.
   *
   * Moving a token from `localStorage` to `sessionStorage` is a deliberate
   * behaviour change for causal and forecasting. Without this migration the
   * change would silently log every existing user out on upgrade, so the
   * legacy value is carried across and only then deleted.
   *
   * Deleting the legacy entry is what makes this idempotent: a second pass
   * finds nothing to move. The in-memory `migrated` flag only avoids repeating
   * the scan on every read.
   */
  migrateLegacyKeys(): void {
    if (this.migrated) return;
    this.migrated = true;

    for (const entry of this.options.legacyTokenKeys ?? []) {
      const { from, area: fromArea } = asMigration(entry, 'local');
      const value = read(fromArea, from);
      remove(fromArea, from);
      if (value && !read('session', this.key(TOKEN_KEY))) {
        write('session', this.key(TOKEN_KEY), value);
      }
    }

    for (const entry of this.options.legacyWorkspaceKeys ?? []) {
      const { from, area: fromArea } = asMigration(entry, 'local');
      const value = read(fromArea, from);
      remove(fromArea, from);
      if (value && !read('local', this.key(WORKSPACE_KEYS_KEY))) {
        write('local', this.key(WORKSPACE_KEYS_KEY), value);
      }
    }

    for (const entry of this.options.legacyPrefKeys ?? []) {
      const value = read(entry.area, entry.from);
      remove(entry.area, entry.from);
      if (!entry.to || !value) continue;
      const target = this.key(entry.to);
      if (!read(entry.area, target)) write(entry.area, target, value);
    }

    for (const rule of this.options.legacyPrefPrefixes ?? []) {
      const fromArea = rule.area ?? 'local';
      for (const key of keysIn(fromArea)) {
        if (!key.startsWith(rule.from)) continue;
        const value = read(fromArea, key);
        remove(fromArea, key);
        const target = this.key(rule.to + key.slice(rule.from.length));
        if (value && !read(fromArea, target)) write(fromArea, target, value);
      }
    }
  }
}
