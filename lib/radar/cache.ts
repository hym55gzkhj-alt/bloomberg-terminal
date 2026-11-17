import { Redis } from "@upstash/redis";

/**
 * Two-level cache: Upstash Redis (shared across serverless instances) if configured,
 * otherwise a process-local in-memory map. In-flight requests for the same key are
 * de-duplicated so a burst of clients never multiplies provider calls.
 *
 * Every cached value carries its original fetch timestamp so the UI can always show
 * the true age of the data.
 */

interface Envelope<T> {
  v: T;
  fetchedAt: number;
  expiresAt: number;
}

const g = globalThis as unknown as {
  __radarMem?: Map<string, Envelope<unknown>>;
  __radarInflight?: Map<string, Promise<unknown>>;
  __radarRedis?: Redis | null;
  __radarKv?: Map<string, unknown>;
};

if (!g.__radarMem) g.__radarMem = new Map();
const mem = g.__radarMem;
if (!g.__radarInflight) g.__radarInflight = new Map();
const inflight = g.__radarInflight;
if (!g.__radarKv) g.__radarKv = new Map();
const kvMem = g.__radarKv;

function getRedis(): Redis | null {
  if (g.__radarRedis !== undefined) return g.__radarRedis;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  g.__radarRedis = url && token ? new Redis({ url, token }) : null;
  return g.__radarRedis;
}

export function cacheBackend(): "redis" | "memory" {
  return getRedis() ? "redis" : "memory";
}

// ~590 stocks × (history, news, fundamentals …) – keep enough entries in memory
const MAX_MEM_ENTRIES = 8000;

function memSet<T>(key: string, env: Envelope<T>) {
  if (mem.size >= MAX_MEM_ENTRIES) {
    const first = mem.keys().next().value;
    if (first) mem.delete(first);
  }
  mem.set(key, env);
}

async function readEnvelope<T>(key: string, shared: boolean): Promise<Envelope<T> | null> {
  const local = mem.get(key) as Envelope<T> | undefined;
  if (local && local.expiresAt > Date.now()) return local;
  const redis = shared ? getRedis() : null;
  if (!redis) return null;
  try {
    const remote = await redis.get<Envelope<T>>(`radar:${key}`);
    if (remote && remote.expiresAt > Date.now()) {
      memSet(key, remote);
      return remote;
    }
  } catch (err) {
    console.warn("[cache] redis read failed:", (err as Error).message);
  }
  return null;
}

async function writeEnvelope<T>(key: string, env: Envelope<T>, ttlSec: number, shared: boolean) {
  memSet(key, env);
  const redis = shared ? getRedis() : null;
  if (!redis) return;
  try {
    await redis.set(`radar:${key}`, env, { ex: Math.max(1, Math.ceil(ttlSec)) });
  } catch (err) {
    console.warn("[cache] redis write failed:", (err as Error).message);
  }
}

export interface Cached<T> {
  data: T;
  fetchedAt: number;
  cacheHit: boolean;
}

/**
 * Return a cached value or compute it. Errors are NEVER cached and never replaced by
 * made-up data: they propagate to the caller.
 */
export async function cached<T>(
  key: string,
  ttlSec: number | ((value: T) => number),
  fetcher: () => Promise<T>,
  /**
   * shared = also store in Redis (visible to all server instances). High-volume, cheap
   * data (price history, news) stays in process memory to save Redis commands.
   */
  opts: { shared?: boolean } = {}
): Promise<Cached<T>> {
  const shared = opts.shared ?? true;
  const hit = await readEnvelope<T>(key, shared);
  if (hit) return { data: hit.v, fetchedAt: hit.fetchedAt, cacheHit: true };

  const running = inflight.get(key) as Promise<Cached<T>> | undefined;
  if (running) return running;

  const p = (async () => {
    try {
      const v = await fetcher();
      const now = Date.now();
      const ttl = typeof ttlSec === "function" ? ttlSec(v) : ttlSec;
      await writeEnvelope(key, { v, fetchedAt: now, expiresAt: now + ttl * 1000 }, ttl, shared);
      return { data: v, fetchedAt: now, cacheHit: false };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Persistent key/value storage (signal history). Redis if available, else memory. */
export async function kvGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (redis) {
    try {
      return (await redis.get<T>(`radar:kv:${key}`)) ?? null;
    } catch (err) {
      console.warn("[kv] redis read failed:", (err as Error).message);
    }
  }
  return (kvMem.get(key) as T) ?? null;
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  kvMem.set(key, value);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(`radar:kv:${key}`, value);
  } catch (err) {
    console.warn("[kv] redis write failed:", (err as Error).message);
  }
}

// ------------------------------------------------------------------ hash store
const g2 = globalThis as unknown as { __radarHash?: Map<string, Map<string, unknown>> };
if (!g2.__radarHash) g2.__radarHash = new Map();
const hashMem = g2.__radarHash;

function localHash(name: string): Map<string, unknown> {
  let h = hashMem.get(name);
  if (!h) {
    h = new Map();
    hashMem.set(name, h);
  }
  return h;
}

/**
 * Reads a whole hash (one Redis command). Falls back to / merges with process memory.
 */
export async function hashGetAll<T>(name: string): Promise<Record<string, T>> {
  const local = localHash(name);
  const redis = getRedis();
  if (redis) {
    try {
      const remote = (await redis.hgetall<Record<string, T>>(`radar:h:${name}`)) ?? {};
      for (const [k, v] of Object.entries(remote)) local.set(k, v);
    } catch (err) {
      console.warn("[hash] redis read failed:", (err as Error).message);
    }
  }
  return Object.fromEntries(local) as Record<string, T>;
}

export async function hashGet<T>(name: string, field: string): Promise<T | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const v = await redis.hget<T>(`radar:h:${name}`, field);
      if (v != null) return v;
    } catch (err) {
      console.warn("[hash] redis read failed:", (err as Error).message);
    }
  }
  return (localHash(name).get(field) as T) ?? null;
}

/** Writes many fields in ONE Redis command (HSET with multiple pairs). */
export async function hashSetMany<T>(name: string, values: Record<string, T>): Promise<void> {
  const entries = Object.entries(values);
  if (!entries.length) return;
  const local = localHash(name);
  for (const [k, v] of entries) local.set(k, v);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.hset(`radar:h:${name}`, values as Record<string, unknown>);
  } catch (err) {
    console.warn("[hash] redis write failed:", (err as Error).message);
  }
}
