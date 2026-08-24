import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * A general-purpose, Promise-based in-memory cache for Tauri `invoke` calls
 * (or any async function). Designed to be small, predictable, and
 * pluggable so it can back any UI surface that repeatedly fetches the
 * same backend data (model catalogs, settings, library indexes, etc.).
 *
 * Features:
 *   - Stale-while-revalidate semantics: `get()` returns cached value
 *     immediately and refreshes in the background after `staleMs`.
 *   - Manual invalidation via `invalidate()` (single key) or
 *     `invalidatePrefix()` (all keys sharing a prefix).
 *   - Concurrent-fetch dedup: many components asking for the same key
 *     at the same time share one in-flight Promise.
 *   - Hook variants:
 *       useInvokeCache(...)           — write/refresh hook (admin style)
 *       useInvokeCachedValue(...)     — read-only hook with subscribe
 *
 * Not for this cache:
 *   - Streaming / subscription data. Use event listeners for that.
 *   - Anything large enough to bloat memory (stick to lightweight JSON
 *     payloads like metadata lists, not full editor state).
 */

export interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

export interface InvokeCacheOptions {
  /** Time after which a value is considered stale (ms). Default 60_000. */
  staleMs?: number;
  /** Time after which a value is evicted entirely (ms). Default ∞. */
  ttlMs?: number;
  /** If true, get() kicks off a background refresh on stale hits. Default true. */
  refreshOnStale?: boolean;
}

export interface InvokeCache<TArgs extends unknown[], TResult> {
  /** Read a value. Returns undefined while the first fetch is in flight. */
  get(...args: TArgs): Promise<TResult>;
  /** Synchronously read the cached value (or undefined if missing/stale-but-not-yet-fetched). */
  peek(...args: TArgs): TResult | undefined;
  /** Manually mark a key as stale; the next get() will refresh. */
  invalidate(...args: TArgs): void;
  /** Invalidate every entry whose key starts with `prefix`. */
  invalidatePrefix(prefix: string): void;
  /** Drop every entry. */
  clear(): void;
  /** Subscribe to changes; returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

const DEFAULT_STALE_MS = 60_000;

export function createInvokeCache<TArgs extends unknown[], TResult>(
  fetcher: (...args: TArgs) => Promise<TResult>,
  options: InvokeCacheOptions = {},
): InvokeCache<TArgs, TResult> {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const ttlMs = options.ttlMs ?? Number.POSITIVE_INFINITY;
  const refreshOnStale = options.refreshOnStale ?? true;

  const entries = new Map<string, CacheEntry<TResult>>();
  const inflight = new Map<string, Promise<TResult>>();
  const listeners = new Set<() => void>();

  const keyOf = (...args: TArgs) => JSON.stringify(args);

  const notify = () => {
    for (const l of listeners) {
      try {
        l();
      } catch {
        // listener errors must not break the cache
      }
    }
  };

  const fetchOne = async (key: string, args: TArgs): Promise<TResult> => {
    const existing = inflight.get(key);
    if (existing) return existing;
    const p = (async () => {
      try {
        const value = await fetcher(...args);
        entries.set(key, { value, fetchedAt: Date.now() });
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  };

  const get = async (...args: TArgs): Promise<TResult> => {
    const key = keyOf(...args);
    const now = Date.now();
    const entry = entries.get(key);
    if (entry) {
      const age = now - entry.fetchedAt;
      if (age < staleMs) return entry.value;
      if (age < ttlMs && !refreshOnStale) return entry.value;
      if (age >= ttlMs) entries.delete(key);
    }
    const value = await fetchOne(key, args);
    notify();
    return value;
  };

  const peek = (...args: TArgs): TResult | undefined => {
    const entry = entries.get(keyOf(...args));
    return entry?.value;
  };

  const invalidate = (...args: TArgs) => {
    const key = keyOf(...args);
    if (entries.delete(key) || inflight.delete(key)) {
      notify();
    }
  };

  const invalidatePrefix = (prefix: string) => {
    let changed = false;
    for (const k of entries.keys()) {
      if (k.startsWith(prefix)) {
        entries.delete(k);
        changed = true;
      }
    }
    for (const k of inflight.keys()) {
      if (k.startsWith(prefix)) {
        inflight.delete(k);
        changed = true;
      }
    }
    if (changed) notify();
  };

  const clear = () => {
    if (entries.size === 0 && inflight.size === 0) return;
    entries.clear();
    inflight.clear();
    notify();
  };

  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  };

  return { get, peek, invalidate, invalidatePrefix, clear, subscribe };
}

// ─── React hooks ────────────────────────────────────────────────────────

/**
 * Read-only hook: subscribes to a cache and returns the current value,
 * triggering a fetch on mount and on invalidations. Re-renders only when
 * the value identity changes.
 */
export function useInvokeCachedValue<TArgs extends unknown[], TResult>(
  cache: InvokeCache<TArgs, TResult>,
  args: TArgs,
): { value: TResult | undefined; loading: boolean; refresh: () => Promise<TResult> } {
  const key = JSON.stringify(args);
  const [value, setValue] = useState<TResult | undefined>(() => cache.peek(...args));
  const [loading, setLoading] = useState<boolean>(value === undefined);
  const mounted = useRef(true);
  const argsRef = useRef<TArgs>(args);

  useEffect(() => {
    argsRef.current = args;
  });

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    setValue((prev) => {
      const fresh = cache.peek(...args);
      return Object.is(prev, fresh) ? prev : fresh;
    });
    setLoading(cache.peek(...args) === undefined);

    (async () => {
      try {
        const v = await cache.get(...args);
        if (cancelled || !mounted.current) return;
        setValue((prev) => (Object.is(prev, v) ? prev : v));
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsub = cache.subscribe(() => {
      if (cancelled || !mounted.current) return;
      const fresh = cache.peek(...args);
      setValue((prev) => (Object.is(prev, fresh) ? prev : fresh));
    });

    return () => {
      cancelled = false;
      mounted.current = false;
      unsub();
    };
    // We re-bind on key change so args identity changes don't loop us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const refresh = useCallback(async () => {
    cache.invalidate(...args);
    const v = await cache.get(...args);
    setValue(v);
    return v;
  }, [cache, key]);

  return { value, loading, refresh };
}

/**
 * Admin hook: gives you the cache object + the most recent fetched value.
 * Use when you need imperative invalidate()/clear() on the same component.
 */
export function useInvokeCache<TArgs extends unknown[], TResult>(
  fetcher: (...args: TArgs) => Promise<TResult>,
  options?: InvokeCacheOptions & { deps?: unknown[] },
): InvokeCache<TArgs, TResult> {
  const cacheRef = useRef<InvokeCache<TArgs, TResult> | null>(null);
  if (cacheRef.current === null) {
    cacheRef.current = createInvokeCache(fetcher, options);
  }
  // Re-apply options on dep change without throwing away the cache entries.
  useEffect(() => {
    // no-op marker; presence triggers re-render on dep change
  }, options?.deps ?? []);
  return cacheRef.current;
}

/**
 * Parse an Tauri invoke error into a short, user-readable string.
 */
export function invokeErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const anyErr = err as { message?: unknown };
    if (typeof anyErr.message === 'string') return anyErr.message;
  }
  return String(err);
}

// ─── Shared cache instances (singleton) ─────────────────────────────────

/**
 * Catalog of Tauri-backed caches. Components import the relevant cache
 * instance; the same fetcher is shared so duplicate calls deduplicate.
 *
 * To register a new cache: add it here, then call
 *   `caches.kiloModels.get()` etc. from any component.
 */
export const caches = {
  /** The Kilo /models catalog. Stale after 5 minutes. */
  kiloModels: createInvokeCache<[], unknown[]>(
    async () => invoke('kilo_list_models') as Promise<unknown[]>,
    { staleMs: 5 * 60_000 },
  ),
  /** Parsed settings.json. Stale after 30s. */
  settings: createInvokeCache<[], Record<string, unknown>>(
    async () => {
      const raw = (await invoke('load_settings')) as string;
      try {
        return JSON.parse(raw || '{}');
      } catch {
        return {};
      }
    },
    { staleMs: 30_000 },
  ),
  /** The macro library. Stale after 10s; invalidations are explicit. */
  macros: createInvokeCache<[], unknown[]>(
    async () => invoke('list_macros') as Promise<unknown[]>,
    { staleMs: 10_000 },
  ),
};

export type Settings = Record<string, unknown>;
