import { describe, expect, it } from "vitest";
import { RateLimiter, runInBackground } from "../providers/http";

describe("RateLimiter priorities", () => {
  it("serves interactive (foreground) calls before queued background work", async () => {
    const limiter = new RateLimiter(100, 60_000, 1);
    const order: string[] = [];
    const task = (name: string) => () =>
      new Promise<void>((r) =>
        setTimeout(() => {
          order.push(name);
          r();
        }, 5)
      );
    const bg = runInBackground(() =>
      Promise.all([1, 2, 3, 4].map((i) => limiter.schedule(task(`bg${i}`))))
    );
    await new Promise((r) => setTimeout(r, 1));
    const fg = limiter.schedule(task("fg"));
    await Promise.all([bg, fg]);
    // bg1 was already running; the foreground call must come right after it
    expect(order.indexOf("fg")).toBe(1);
  });

  it("rejects queued calls immediately when the precheck fails (circuit breaker)", async () => {
    const limiter = new RateLimiter(100, 60_000, 1);
    const slow = limiter.schedule(() => new Promise((r) => setTimeout(r, 20)));
    const blocked = limiter.schedule(
      () => Promise.resolve("ran"),
      () => new Error("breaker open")
    );
    await expect(blocked).rejects.toThrow("breaker open");
    await slow;
  });
});
