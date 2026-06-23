import { describe, it, expect, vi, afterEach } from "vitest";
import {
  detectRegression,
  buildRegressionMessage,
  buildFleetDigestMessage,
  buildLowCreditsMessage,
  creditsAlertThreshold,
  dispatchAlert,
  digestHasSignal,
  isAlertConfigured,
  isLowCreditsCrossing,
  resolveAlertWebhook,
  validateAlertWebhookUrl,
  DEFAULT_THRESHOLDS,
  type AlertMessage,
  type FleetDigestInput,
} from "./alerts";
import type { ScanDiff } from "@/lib/report/compare";
import { postureFor } from "@/lib/maturity/model";

/** Build a minimal ScanDiff with the fields the detector reads. */
function diff(over: Partial<ScanDiff> = {}): ScanDiff {
  const base: ScanDiff = {
    overall: { before: 60, after: 60, delta: 0 },
    level: { before: { id: "L3", name: "Augmented" }, after: { id: "L3", name: "Augmented" }, changed: false, up: false },
    adoption: { before: 60, after: 60, delta: 0 },
    rigor: { before: 60, after: 60, delta: 0 },
    posture: { before: postureFor(60, 60), after: postureFor(60, 60), changed: false },
    dimensions: [],
    recsMovedToDone: [],
    closedGapCount: 0,
    openedGapCount: 0,
    appearedSignalCount: 0,
    disappearedSignalCount: 0,
    movements: [],
    unchanged: true,
  };
  return { ...base, ...over };
}

describe("detectRegression", () => {
  it("flags a level demotion as critical", () => {
    const v = detectRegression(
      diff({ level: { before: { id: "L4", name: "Integrated" }, after: { id: "L3", name: "Augmented" }, changed: true, up: false } }),
    );
    expect(v.regressed).toBe(true);
    expect(v.severity).toBe("critical");
    expect(v.reasons[0].code).toBe("level-demotion");
  });

  it("flags a slide into ungoverned as critical", () => {
    const v = detectRegression(
      diff({ posture: { before: postureFor(60, 60), after: postureFor(60, 30), changed: true } }),
    );
    expect(v.severity).toBe("critical");
    expect(v.reasons.some((r) => r.code === "posture-ungoverned")).toBe(true);
  });

  it("flags an overall drop past the threshold as a warning", () => {
    const v = detectRegression(diff({ overall: { before: 60, after: 52, delta: -8 } }));
    expect(v.regressed).toBe(true);
    expect(v.severity).toBe("warning");
    expect(v.reasons[0].code).toBe("overall-drop");
  });

  it("ignores a small dip below the threshold", () => {
    const v = detectRegression(diff({ overall: { before: 60, after: 58, delta: -2 } }));
    expect(v.regressed).toBe(false);
    expect(v.severity).toBeNull();
  });

  it("flags a single-dimension crater even when overall barely moves", () => {
    const v = detectRegression(
      diff({
        overall: { before: 60, after: 58, delta: -2 },
        dimensions: [
          { id: "D2", name: "Automated Testing", before: 80, after: 60, delta: -20, signalDelta: -20, closedGaps: [], openedGaps: [], appearedSignals: [], disappearedSignals: [], attribution: null },
        ],
      }),
    );
    expect(v.regressed).toBe(true);
    expect(v.reasons.some((r) => r.code === "dimension-drop")).toBe(true);
  });

  it("respects custom thresholds", () => {
    const d = diff({ overall: { before: 60, after: 57, delta: -3 } });
    expect(detectRegression(d, DEFAULT_THRESHOLDS).regressed).toBe(false);
    expect(detectRegression(d, { overallDrop: 2, dimensionDrop: 15 }).regressed).toBe(true);
  });
});

describe("buildRegressionMessage", () => {
  it("includes the reasons and the 'why' movement attributions", () => {
    const d = diff({
      level: { before: { id: "L4", name: "Integrated" }, after: { id: "L3", name: "Augmented" }, changed: true, up: false },
      movements: ["D2 -20: removed Coverage tracking configured"],
    });
    const v = detectRegression(d);
    const msg = buildRegressionMessage({ fullName: "acme/api", url: "https://x/report" }, d, v);
    expect(msg.text).toContain("acme/api regressed");
    expect(msg.text).toContain("L4 → L3");
    expect(msg.text).toContain("D2 -20");
    expect(msg.text).toContain("https://x/report");
    expect(Array.isArray(msg.blocks)).toBe(true);
  });
});

describe("isLowCreditsCrossing", () => {
  it("fires exactly on the threshold and on zero, nowhere else", () => {
    expect(isLowCreditsCrossing(5, 5)).toBe(true);
    expect(isLowCreditsCrossing(0, 5)).toBe(true);
    expect(isLowCreditsCrossing(6, 5)).toBe(false);
    expect(isLowCreditsCrossing(4, 5)).toBe(false);
    expect(isLowCreditsCrossing(1, 5)).toBe(false);
  });
  it("a zero threshold fires only at depletion (and only once)", () => {
    expect(isLowCreditsCrossing(0, 0)).toBe(true);
    expect(isLowCreditsCrossing(1, 0)).toBe(false);
  });
});

describe("creditsAlertThreshold", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("defaults to 5 when unset or blank (blank means default, never 0)", () => {
    vi.stubEnv("CREDITS_ALERT_THRESHOLD", "");
    expect(creditsAlertThreshold()).toBe(5);
  });
  it("honors an explicit value, including a deliberate 0", () => {
    vi.stubEnv("CREDITS_ALERT_THRESHOLD", "12");
    expect(creditsAlertThreshold()).toBe(12);
    vi.stubEnv("CREDITS_ALERT_THRESHOLD", "0");
    expect(creditsAlertThreshold()).toBe(0);
  });
  it("rejects junk and negatives back to the default", () => {
    vi.stubEnv("CREDITS_ALERT_THRESHOLD", "lots");
    expect(creditsAlertThreshold()).toBe(5);
    vi.stubEnv("CREDITS_ALERT_THRESHOLD", "-3");
    expect(creditsAlertThreshold()).toBe(5);
  });
});

describe("buildLowCreditsMessage", () => {
  it("low-water crossing names the org, balance, threshold and manage link", () => {
    const msg = buildLowCreditsMessage({ org: "acme", balance: 5, threshold: 5, url: "https://x/org/acme" });
    expect(msg.text).toContain("acme is low on scan credits — 5 left");
    expect(msg.text).toContain("low-water mark (5)");
    expect(msg.text).toContain("https://x/org/acme");
    expect(Array.isArray(msg.blocks)).toBe(true);
  });
  it("depletion says scans are paused, and omits the link cleanly when no base URL", () => {
    const msg = buildLowCreditsMessage({ org: "acme", balance: 0, threshold: 5 });
    expect(msg.text).toContain("acme is out of scan credits");
    expect(msg.text).toContain("paused");
    expect(msg.text).not.toContain("undefined");
  });
});

describe("buildFleetDigestMessage credits line", () => {
  const base: FleetDigestInput = {
    org: "acme",
    repoCount: 3,
    scannedCount: 3,
    avgOverall: 60,
    level: "L3 · Defined",
    overallDelta: null,
    gainers: [],
    regressers: [],
    topRecommendation: null,
  };
  it("appends the top-up line when creditsRemaining is set (0 included)", () => {
    expect(buildFleetDigestMessage({ ...base, creditsRemaining: 3 }).text).toContain("Credits remaining: 3");
    expect(buildFleetDigestMessage({ ...base, creditsRemaining: 0 }).text).toContain("Credits remaining: 0");
  });
  it("omits it for unmetered / healthy orgs (null or undefined)", () => {
    expect(buildFleetDigestMessage(base).text).not.toContain("Credits remaining");
    expect(buildFleetDigestMessage({ ...base, creditsRemaining: null }).text).not.toContain("Credits remaining");
  });
});

describe("resolveAlertWebhook / isAlertConfigured (per-org routing)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("the org's own webhook wins over the global env", () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example/global");
    expect(resolveAlertWebhook("https://hooks.example/acme")).toBe("https://hooks.example/acme");
  });
  it("falls back to the global env when the org has none", () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example/global");
    expect(resolveAlertWebhook(null)).toBe("https://hooks.example/global");
    expect(resolveAlertWebhook(undefined)).toBe("https://hooks.example/global");
    expect(resolveAlertWebhook("   ")).toBe("https://hooks.example/global");
  });
  it("resolves to null (clean no-op) when neither is configured", () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "");
    expect(resolveAlertWebhook(null)).toBeNull();
    expect(isAlertConfigured()).toBe(false);
  });
  it("an org sink counts as configured even with no global env", () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "");
    expect(isAlertConfigured("https://hooks.example/acme")).toBe(true);
  });
});

describe("validateAlertWebhookUrl", () => {
  it("accepts a normal https webhook", () => {
    const v = validateAlertWebhookUrl("https://hooks.slack.com/services/T0/B0/xyz");
    expect(v).toEqual({ ok: true, url: "https://hooks.slack.com/services/T0/B0/xyz" });
  });
  it("rejects junk, http, credentials and over-long URLs", () => {
    expect(validateAlertWebhookUrl("not a url").ok).toBe(false);
    expect(validateAlertWebhookUrl("http://hooks.example/x").ok).toBe(false);
    expect(validateAlertWebhookUrl("https://user:pw@hooks.example/x").ok).toBe(false);
    expect(validateAlertWebhookUrl(`https://hooks.example/${"a".repeat(1000)}`).ok).toBe(false);
  });
  it("rejects localhost and private-range IP literals (the server POSTs org data there)", () => {
    for (const u of [
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://10.1.2.3/hook",
      "https://192.168.1.5/hook",
      "https://172.16.0.9/hook",
      "https://169.254.1.1/hook",
      "https://[::1]/hook",
    ]) {
      expect(validateAlertWebhookUrl(u).ok).toBe(false);
    }
  });
  // Hardening: the shared SSRF guard widened coverage past the old hand-rolled list to the same ranges
  // the branding logo-URL guard always blocked — these all used to slip through to the webhook sink.
  it("rejects the ranges the old webhook list missed (CGNAT, IPv6 ULA/link-local, multicast, internal hostnames)", () => {
    for (const u of [
      "https://100.64.0.1/hook", // CGNAT 100.64.0.0/10
      "https://[fc00::1]/hook", // IPv6 unique-local
      "https://[fd00::1]/hook", // IPv6 unique-local
      "https://[fe80::1]/hook", // IPv6 link-local
      "https://224.0.0.1/hook", // multicast / reserved
      "https://printer.local/hook", // mDNS internal
      "https://api.internal/hook", // internal TLD
      "https://metadata.google.internal/hook", // cloud metadata hostname
    ]) {
      expect(validateAlertWebhookUrl(u).ok).toBe(false);
    }
  });
});

describe("dispatchAlert (the one real side-effect: 2xx/non-2xx/throw outcome mapping)", () => {
  const ORG_HOOK = "https://hooks.example/acme";
  const msg: AlertMessage = {
    text: "🔻 Ascent: acme/api regressed",
    blocks: [{ type: "section", text: { type: "mrkdwn", text: "*headline*" } }],
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Stub global fetch with a vi.fn() resolving a Response-like { ok, status }. */
  function stubFetch(impl: (...args: unknown[]) => unknown) {
    const fetchMock = vi.fn(impl as never);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("2xx ⇒ returns true and POSTs the documented payload to the resolved org URL", async () => {
    const fetchMock = stubFetch(() => Promise.resolve({ ok: true, status: 200 }));
    // Quiet the console.error-free happy path while also proving no env fallback is needed.
    vi.stubEnv("ALERT_WEBHOOK_URL", "");

    const ok = await dispatchAlert(msg, { webhookUrl: ORG_HOOK });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ORG_HOOK); // per-org sink, not the (empty) global
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    // Body carries exactly { text, blocks } — the contract every caller's boolean rides on.
    expect(JSON.parse(init.body as string)).toEqual({ text: msg.text, blocks: msg.blocks });
  });

  it("threads opts.signal through to fetch (abortable with the surrounding work)", async () => {
    const fetchMock = stubFetch(() => Promise.resolve({ ok: true, status: 201 }));
    const controller = new AbortController();

    const ok = await dispatchAlert(msg, { webhookUrl: ORG_HOOK, signal: controller.signal });

    expect(ok).toBe(true); // 201 is 2xx
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("non-2xx (4xx/5xx) ⇒ returns false (never falsely claims delivered) and does NOT throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const status of [400, 404, 500, 503]) {
      const fetchMock = stubFetch(() => Promise.resolve({ ok: false, status }));
      await expect(dispatchAlert(msg, { webhookUrl: ORG_HOOK })).resolves.toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("a network throw is caught and reported as failure — never propagates into the scan path", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = stubFetch(() => Promise.reject(new Error("ECONNREFUSED")));

    // resolves(false), does not reject — the "never throws, can't fail the scan" guarantee.
    await expect(dispatchAlert(msg, { webhookUrl: ORG_HOOK })).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("no resolvable sink ⇒ returns false and never calls fetch (never POST without a sink)", async () => {
    const fetchMock = stubFetch(() => Promise.resolve({ ok: true, status: 200 }));
    vi.stubEnv("ALERT_WEBHOOK_URL", ""); // no global either

    const ok = await dispatchAlert(msg, { webhookUrl: null });

    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the global ALERT_WEBHOOK_URL when the org has no sink", async () => {
    const fetchMock = stubFetch(() => Promise.resolve({ ok: true, status: 200 }));
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example/global");

    const ok = await dispatchAlert(msg, { webhookUrl: null });

    expect(ok).toBe(true);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://hooks.example/global");
  });
});

describe("digestHasSignal — the weekly-digest movement-gate", () => {
  const flat = { overallDelta: 1, levelChanges: 0, regressions: 0, gainersBeyondNoise: 0, creditLow: false };

  it("stays silent on a flat period (within-noise delta, no level/regression/gainer, credits fine)", () => {
    expect(digestHasSignal(flat)).toBe(false);
    expect(digestHasSignal({ ...flat, overallDelta: -2 })).toBe(false); // still within the noise band
    expect(digestHasSignal({ ...flat, overallDelta: null })).toBe(false);
  });

  it("fires on real movement: an overall move beyond the noise band, a level change, a regression, or a gainer", () => {
    expect(digestHasSignal({ ...flat, overallDelta: 6 })).toBe(true);
    expect(digestHasSignal({ ...flat, overallDelta: -6 })).toBe(true);
    expect(digestHasSignal({ ...flat, levelChanges: 1 })).toBe(true);
    expect(digestHasSignal({ ...flat, regressions: 1 })).toBe(true);
    expect(digestHasSignal({ ...flat, gainersBeyondNoise: 1 })).toBe(true);
  });

  it("always fires when credits are low — a depleting balance is worth the push even on a flat week", () => {
    expect(digestHasSignal({ ...flat, creditLow: true })).toBe(true);
  });
});
