/** Small HTTP helpers shared by all providers. */

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number
  ) {
    super(`${provider}: ${message}`);
  }
}

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Marks provider calls made by the background scan. Interactive requests (detail view,
 * status, overview) are always served before queued background work.
 */
export const requestContext = new AsyncLocalStorage<{ background: boolean }>();

export function runInBackground<T>(fn: () => Promise<T>): Promise<T> {
  return requestContext.run({ background: true }, fn);
}

interface QueueItem {
  resolve: () => void;
  reject: (err: Error) => void;
  precheck?: () => Error | null;
  background: boolean;
}

/**
 * Simple concurrency + rate limiter (sliding window). A `precheck` (e.g. an open
 * circuit breaker) is evaluated when a queued call reaches the front: failing calls are
 * rejected immediately and do not consume a rate-limit slot.
 */
export class RateLimiter {
  private timestamps: number[] = [];
  private active = 0;
  private queue: QueueItem[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private maxPerWindow: number,
    private windowMs: number,
    private maxConcurrent: number
  ) {}

  async schedule<T>(fn: () => Promise<T>, precheck?: () => Error | null): Promise<T> {
    const background = requestContext.getStore()?.background ?? false;
    await new Promise<void>((resolve, reject) => {
      const item = { resolve, reject, precheck, background };
      if (background) this.queue.push(item);
      else {
        // foreground: ahead of all queued background work
        const firstBg = this.queue.findIndex((q) => q.background);
        if (firstBg < 0) this.queue.push(item);
        else this.queue.splice(firstBg, 0, item);
      }
      this.next();
    });
    try {
      return await fn();
    } finally {
      this.active--;
      this.next();
    }
  }

  private next() {
    // drop queued items whose precheck fails
    while (this.queue.length && this.queue[0].precheck) {
      const err = this.queue[0].precheck?.();
      if (!err) break;
      this.queue.shift()?.reject(err);
    }
    if (!this.queue.length || this.active >= this.maxConcurrent) return;
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length >= this.maxPerWindow) {
      if (!this.timer) {
        const wait = this.windowMs - (now - this.timestamps[0]) + 5;
        this.timer = setTimeout(() => {
          this.timer = null;
          this.next();
        }, wait);
      }
      return;
    }
    const item = this.queue.shift();
    if (!item) return;
    this.active++;
    this.timestamps.push(now);
    item.resolve();
    this.next();
  }
}

export async function fetchJson<T>(
  provider: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15000);
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const text = await res.text();
    if (process.env.RADAR_DEBUG) {
      console.log(
        `[http] ${provider} ${res.status} ${Date.now() - started}ms ${url.replace(/token=[^&]+/, "token=***").slice(0, 110)}`
      );
    }
    if (!res.ok) {
      throw new ProviderError(provider, `HTTP ${res.status} ${text.slice(0, 160)}`, res.status);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderError(provider, `invalid JSON response: ${text.slice(0, 120)}`);
    }
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if ((err as Error).name === "AbortError")
      throw new ProviderError(provider, "request timed out");
    throw new ProviderError(provider, (err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}
