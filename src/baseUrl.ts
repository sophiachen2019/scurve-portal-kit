/**
 * Base URL resolution. `portal_ui_standards.md` section 4.1.
 *
 * No Cloud Run URL in frontend source. Deployed hostnames belong in deploy
 * configuration, not in a module constant next to the code that fetches.
 */

export interface BaseUrlOptions {
  /**
   * The build-time value, normally `import.meta.env.VITE_API_BASE`.
   *
   * The kit reads `import.meta.env` itself when this is omitted. A portal
   * passes it explicitly when its bundler does not substitute
   * `import.meta.env` inside dependencies — see `readBuildTimeBase`.
   */
  buildTimeBase?: string;
  /**
   * Extra `window` property names to accept as a runtime override, checked
   * after `SCURVE_API_BASE`. Exists so a portal can keep an override name it
   * has already documented (forecasting: `FORECASTING_API_BASE`).
   */
  runtimeOverrideKeys?: readonly string[];
  /** Same-origin fallback. Section 4.1 step 3. */
  fallback?: string;
}

/** The runtime override every portal honours. */
export const RUNTIME_OVERRIDE_KEY = 'SCURVE_API_BASE';

const DEFAULT_FALLBACK = '/api';

/** Strips a trailing slash so `base + path` never doubles up. */
export function normalizeBase(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/**
 * Reads `import.meta.env.VITE_API_BASE`.
 *
 * Written as a whole-object read rather than a direct property access because
 * `import.meta.env` is not typed outside a Vite source file, and because Vite
 * substitutes the whole object. Returns undefined anywhere `import.meta.env`
 * does not exist (tsc output run under plain Node, a test harness).
 */
export function readBuildTimeBase(): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const value = env?.VITE_API_BASE;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readRuntimeOverride(keys: readonly string[]): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const scope = window as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = scope[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

/**
 * Resolves the API base URL in the order fixed by section 4.1:
 *
 * 1. the build-time variable,
 * 2. a runtime override on `window`, for a page served from an unexpected
 *    origin,
 * 3. same-origin `/api`.
 */
export function resolveApiBase(options: BaseUrlOptions = {}): string {
  const buildTime =
    options.buildTimeBase === undefined ? readBuildTimeBase() : options.buildTimeBase;
  if (buildTime && buildTime.trim()) return normalizeBase(buildTime);

  const override = readRuntimeOverride([
    RUNTIME_OVERRIDE_KEY,
    ...(options.runtimeOverrideKeys ?? []),
  ]);
  if (override) return normalizeBase(override);

  return normalizeBase(options.fallback ?? DEFAULT_FALLBACK);
}

/**
 * The origin root for endpoints mounted outside the API prefix.
 *
 * All three backends serve `/health` at the application root, not under
 * `/api`, so the health check cannot just append to the API base.
 */
export function originRoot(apiBase: string): string {
  return normalizeBase(apiBase).replace(/\/api$/, '');
}
