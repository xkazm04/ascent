// @vitest-environment jsdom
// branding-1: useBrandingCheck asks the server what a save WOULD do, debounced under the form. Pins
// the 600 ms debounce (one POST per pause), stale-response drop (an older answer never overwrites a
// newer draft's verdict) and probe-only-on-logo-change (the guarded fetch runs once per URL).

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBrandingCheck, BRANDING_CHECK_DEBOUNCE_MS, type BrandingDraft } from "./useBrandingCheck";

type Pending = { body: Record<string, unknown>; resolve: (v: unknown) => void };
let pending: Pending[] = [];

function verdict(over: Record<string, unknown> = {}) {
  return { branding: { brandName: null, brandColor: null, logoUrl: null }, rejected: [], reasons: {}, logo: "none", contrast: { onWhite: 5, onDark: 4 }, ...over };
}

beforeEach(() => {
  vi.useFakeTimers();
  pending = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((resolve) => {
          pending.push({ body: JSON.parse(String(init?.body)), resolve });
        }),
    ),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const draft = (over: Partial<BrandingDraft> = {}): BrandingDraft => ({ brandName: "", brandColor: "", logoUrl: "", ...over });

async function answer(i: number, body: unknown) {
  await act(async () => {
    pending[i]!.resolve({ ok: true, json: async () => body });
  });
}

function mount(initial: BrandingDraft) {
  return renderHook(({ d }) => useBrandingCheck("acme", d), { initialProps: { d: initial } });
}

describe("useBrandingCheck", () => {
  it("does not check the untouched stored branding on mount", async () => {
    mount(draft());
    await act(async () => vi.advanceTimersByTime(BRANDING_CHECK_DEBOUNCE_MS * 2));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("two edits 200 ms apart send exactly one POST, after the 600 ms debounce", async () => {
    const { rerender } = mount(draft());
    rerender({ d: draft({ brandName: "A" }) });
    await act(async () => vi.advanceTimersByTime(200));
    rerender({ d: draft({ brandName: "Ac" }) });
    await act(async () => vi.advanceTimersByTime(BRANDING_CHECK_DEBOUNCE_MS - 1));
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("/api/org/branding/check");
    expect(pending[0]!.body).toMatchObject({ org: "acme", brandName: "Ac" });
  });

  it("drops a response for edit 1 that resolves after edit 2's", async () => {
    const { result, rerender } = mount(draft());
    rerender({ d: draft({ brandColor: "blue" }) });
    await act(async () => vi.advanceTimersByTime(BRANDING_CHECK_DEBOUNCE_MS));
    rerender({ d: draft({ brandColor: "#c41e3a" }) });
    await act(async () => vi.advanceTimersByTime(BRANDING_CHECK_DEBOUNCE_MS));
    expect(pending).toHaveLength(2);
    await answer(1, verdict({ branding: { brandName: null, brandColor: "#c41e3a", logoUrl: null } }));
    await answer(0, verdict({ rejected: ["brandColor"], reasons: { brandColor: "not-hex" } }));
    expect(result.current.verdict?.rejected).toEqual([]);
    expect(result.current.verdict?.branding?.brandColor).toBe("#c41e3a");
  });

  it("probes the logo only when its URL changed since the last probe", async () => {
    const { result, rerender } = mount(draft());
    rerender({ d: draft({ logoUrl: "https://acme.com/a.png" }) });
    await act(async () => vi.advanceTimersByTime(BRANDING_CHECK_DEBOUNCE_MS));
    expect(pending[0]!.body.probeLogo).toBe(true);
    await answer(0, verdict({ logo: "unreachable", logoReason: "unreachable" }));

    rerender({ d: draft({ logoUrl: "https://acme.com/a.png", brandName: "Acme" }) });
    await act(async () => vi.advanceTimersByTime(BRANDING_CHECK_DEBOUNCE_MS));
    expect(pending[1]!.body.probeLogo).toBe(false);
    await answer(1, verdict({ logo: "unchecked" }));
    // The earlier probe's answer still holds for the same URL.
    expect(result.current.verdict?.logo).toBe("unreachable");

    rerender({ d: draft({ logoUrl: "https://acme.com/b.png", brandName: "Acme" }) });
    await act(async () => vi.advanceTimersByTime(BRANDING_CHECK_DEBOUNCE_MS));
    expect(pending[2]!.body.probeLogo).toBe(true);
  });

  it("holds no verdict for a draft that changed since the last answer", async () => {
    const { result, rerender } = mount(draft());
    rerender({ d: draft({ brandName: "A" }) });
    await act(async () => vi.advanceTimersByTime(BRANDING_CHECK_DEBOUNCE_MS));
    await answer(0, verdict());
    expect(result.current.verdict).not.toBeNull();
    rerender({ d: draft({ brandName: "B" }) });
    expect(result.current.verdict).toBeNull();
  });

  it("ignores a refused or malformed answer instead of inventing a verdict", async () => {
    const { result, rerender } = mount(draft());
    rerender({ d: draft({ brandName: "A" }) });
    await act(async () => vi.advanceTimersByTime(BRANDING_CHECK_DEBOUNCE_MS));
    await act(async () => {
      pending[0]!.resolve({ ok: false, json: async () => ({ error: "Briefing branding is a Team-plan feature." }) });
    });
    expect(result.current.verdict).toBeNull();
  });
});
