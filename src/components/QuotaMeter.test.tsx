// @vitest-environment jsdom
//
// The two behaviors of the pre-scan quota meter that logic tests can't reach: the out-of-order fetch
// race (an earlier, slower /api/quota response must never clobber a fresher count), and the surfaces
// the ui-perfectionist findings flagged — the `warn` token for the low state and a real /pricing CTA
// instead of dead "upgrade" text.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QuotaMeter } from "./QuotaMeter";

interface Quota {
  enforced: boolean;
  remaining: number;
  limit: number;
  resetAt: number | null;
  scope: "anon" | "user";
}
const res = (data: Quota) => ({ ok: true, json: () => Promise.resolve(data) });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

afterEach(() => vi.restoreAllMocks());

describe("QuotaMeter render states", () => {
  it("renders nothing when the monthly gate isn't enforced", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ enforced: false, remaining: 5, limit: 5, resetAt: null, scope: "anon" })));
    await act(async () => { render(<QuotaMeter />); });
    await flush();
    expect(document.querySelector("p")).toBeNull();
  });

  it("uses the semantic `warn` token (not a raw amber hex) when the allowance is low", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ enforced: true, remaining: 1, limit: 5, resetAt: null, scope: "anon" })));
    await act(async () => { render(<QuotaMeter />); });
    const link = await screen.findByRole("link", { name: "upgrade for more scans" });
    const p = link.closest("p")!;
    expect(p.className).toContain("text-warn");
    expect(p.className).not.toContain("amber");
    expect(p.querySelector("span.font-semibold")?.textContent).toBe("1");
  });

  it("renders the upgrade upsell as a real /pricing link, not dead text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ enforced: true, remaining: 4, limit: 5, resetAt: null, scope: "anon" })));
    await act(async () => { render(<QuotaMeter />); });
    const link = await screen.findByRole("link", { name: "upgrade for more scans" });
    expect(link).toHaveAttribute("href", "/pricing");
    // remaining 4 of 5 is NOT low → the quiet slate tone, never the warn token.
    expect(link.closest("p")!.className).toContain("text-slate-500");
  });

  it("suppresses the upsell entirely while the visitor still holds the FULL allowance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ enforced: true, remaining: 5, limit: 5, resetAt: null, scope: "anon" })));
    await act(async () => { render(<QuotaMeter />); });
    await flush();
    expect(screen.queryByRole("link", { name: "upgrade for more scans" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in for more scans" })).toBeNull();
    expect(document.querySelector("p span.font-semibold")?.textContent).toBe("5"); // meter itself still shows
  });

  it("offers the SIGN-IN CTA first (the report banners' hierarchy) when Supabase auth is wired", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ enforced: true, remaining: 3, limit: 5, resetAt: null, scope: "anon" })));
    await act(async () => { render(<QuotaMeter />); });
    expect(await screen.findByRole("button", { name: "Sign in for more scans" })).toBeInTheDocument();
    // The paid link is the FALLBACK, not a sibling — one CTA, matching quotaCta's hierarchy.
    expect(screen.queryByRole("link", { name: "upgrade for more scans" })).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("QuotaMeter out-of-order fetch race", () => {
  it("ignores an earlier, slower response that resolves after a fresher one", async () => {
    // Two overlapping loads (mount + focus). The MOUNT load is stale (remaining 5); the FOCUS load is
    // fresh (remaining 1). The fresh one resolves FIRST, then the stale one resolves LATE — and must be
    // discarded. Without request sequencing, the late stale payload would win and show 5.
    const deferreds: Array<(v: unknown) => void> = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { deferreds.push(resolve); })));

    await act(async () => { render(<QuotaMeter />); }); // mount → load #1 (stale)
    await act(async () => { window.dispatchEvent(new Event("focus")); }); // → load #2 (fresh)
    expect(deferreds).toHaveLength(2);

    // Resolve the LATER-issued (fresh) load first...
    await act(async () => {
      deferreds[1]!(res({ enforced: true, remaining: 1, limit: 5, resetAt: null, scope: "anon" }));
      await new Promise((r) => setTimeout(r, 0));
    });
    // ...then the EARLIER (stale) load resolves late — it is superseded and must be ignored.
    await act(async () => {
      deferreds[0]!(res({ enforced: true, remaining: 5, limit: 5, resetAt: null, scope: "anon" }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(document.querySelector("p span.font-semibold")?.textContent).toBe("1"); // fresh wins
  });
});
