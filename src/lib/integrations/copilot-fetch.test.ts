import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCopilot } from "./copilot";
import { DEFAULT_GET_TIMEOUT_MS } from "@/lib/github/host";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Copilot transport", () => {
  it.each(["headers", "body"])("bounds a stalled %s exchange and reports unreachable", async (phase) => {
    const timeout = new AbortController();
    const budget = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    const release: (() => void)[] = [];
    const signals: (AbortSignal | null | undefined)[] = [];
    const wait = (signal: AbortSignal | null | undefined) => new Promise<never>((_resolve, reject) => {
      const stop = () => reject(new Error("Timed out"));
      release.push(stop);
      if (signal?.aborted) stop();
      else signal?.addEventListener("abort", stop, { once: true });
    });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal);
      if (phase === "headers") return wait(init.signal);
      return { ok: true, json: () => wait(init.signal) };
    }));
    const pending = fetchCopilot("acme", "synthetic-test-token");
    try {
      expect(signals).toHaveLength(2);
      expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
      expect(budget).toHaveBeenCalledWith(DEFAULT_GET_TIMEOUT_MS);
      timeout.abort();
      await expect(pending).resolves.toEqual({
        seats: null, metrics: [], seatsFailure: "unreachable", metricsFailure: "unreachable",
      });
    } finally {
      // Settle even the pre-fix exchange when the signal assertion fails.
      await Promise.resolve();
      release.forEach((stop) => stop());
      await pending;
    }
  });

  it.each([[401, "denied"], [403, "denied"], [404, "absent"], [503, "unreachable"]] as const)(
    "preserves engagement data when the seat request returns %s", async (status, failure) => {
      const metrics = [{ date: "2026-09-01", total_engaged_users: 7 }];
      const transport = vi.fn(async (url: string, init: RequestInit) => {
        expect(init.headers).toMatchObject({ authorization: "Bearer synthetic-test-token" });
        expect(init.cache).toBe("no-store");
        return url.endsWith("/seats") ? new Response("", { status }) : Response.json(metrics);
      });
      vi.stubGlobal("fetch", transport);
      await expect(fetchCopilot("acme team", "synthetic-test-token")).resolves.toEqual({
        seats: null, metrics, seatsFailure: failure, metricsFailure: null,
      });
      expect(transport.mock.calls[0][0]).toContain("/orgs/acme%20team/copilot/");
    },
  );
});
