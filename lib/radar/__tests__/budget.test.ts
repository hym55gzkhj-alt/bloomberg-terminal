import { describe, expect, it } from "vitest";
import { FINNHUB_PENDING, drainPending, withBudget } from "../analyze";

describe("withBudget (rate-limited provider calls)", () => {
  it("returns fast results normally", async () => {
    await expect(withBudget(Promise.resolve(42), Date.now() + 2000)).resolves.toBe(42);
  });
  it("gives up on slow calls at the deadline but keeps them running in the background", async () => {
    let done = false;
    const slow = new Promise<number>((r) =>
      setTimeout(() => {
        done = true;
        r(1);
      }, 2500)
    );
    const t0 = Date.now();
    await expect(withBudget(slow, Date.now() + 1500)).rejects.toThrow(FINNHUB_PENDING);
    expect(Date.now() - t0).toBeLessThan(2200);
    expect(done).toBe(false);
    await drainPending();
    expect(done).toBe(true);
  });
  it("passes provider errors through", async () => {
    await expect(
      withBudget(Promise.reject(new Error("HTTP 429")), Date.now() + 2000)
    ).rejects.toThrow("HTTP 429");
  });
});
