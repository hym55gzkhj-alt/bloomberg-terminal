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

const MAX_MEM_ENTRIES = 2000;

function memSet<T>(key: string, env: Envelope<T>) {
  if (mem.size >= MAX_MEM_ENTRIES) {
    const first = mem.keys().next().value;
    if (first) mem.delete(first);
  }
  mem.set(key, env);
}

async function readEnvelope<T>(key: string): Promise<Envelope<T> | null> {
  const local = mem.get(key) as Envelope<T> | undefined;
  if (local && local.expiresAt > Date.now()) return local;
  const redis = getRedis();
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

async function writeEnvelope<T>(key: string, env: Envelope<T>, ttlSec: number) {
  memSet(key, env);
  const redis = getRedis();
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
  ttlSec: number,
  fetcher: () => Promise<T>
): Promise<Cached<T>> {
  const hit = await readEnvelope<T>(key);
  if (hit) return { data: hit.v, fetchedAt: hit.fetchedAt, cacheHit: true };

  const running = inflight.get(key) as Promise<Cached<T>> | undefined;
  if (running) return running;

  const p = (async () => {
    try {
      const v = await fetcher();
      const now = Date.now();
      await writeEnvelope(key, { v, fetchedAt: now, expiresAt: now + ttlSec * 1000 }, ttlSec);
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
