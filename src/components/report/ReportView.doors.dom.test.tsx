// @vitest-environment jsdom
// The two client reads ReportView owns on the live-scan path — the passport (the hero) and the
// recommendations (the roadmap tracker) — degrade by design: a failed passport read leaves the hero
// hidden, a failed recommendations read leaves the read-only roadmap. The door sweep kept those
// degrades exactly as they were and only took away the silence: each failure now reaches a
// console.warn naming the read (a client component cannot import the server telemetry helper).
// Pinned per site, with the "not a failure" twins (a 404 passport, an empty recommendations list)
// pinned QUIET, so a refactor back to a bare `catch {}` — or a warn that fires on every answer —
// fails here instead of going dark or crying wolf.

import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ReportView } from "@/components/report/ReportView";
import type { AppPassport, ScanReport } from "@/lib/types";

// The active section is URL-backed (?tab=…); the recommendations cases read the Roadmap tab.
const nav = vi.hoisted(() => ({ query: "" }));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/report",
  useSearchParams: () => new URLSearchParams(nav.query),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
}));

const ROADMAP_TITLE = "Pin an agent contract file";

function makeReport(): ScanReport {
  return {
    repo: {
      owner: "acme",
      name: "widget",
      url: "https://github.com/acme/widget",
      stars: 1,
      forks: 0,
      defaultBranch: "main",
      primaryLanguage: "TypeScript",
    },
    overallScore: 72,
    level: { id: "L3", name: "Assisted", blurb: "b", range: [60, 79] },
    archetype: "team",
    adoptionScore: 65,
    rigorScore: 55,
    posture: { id: "ai-native", label: "AI-native", blurb: "b" },
    aiUsage: { detected: true, commitFraction: 0.3, signals: [] },
    contributors: [],
    dimensions: [],
    headline: "Strong AI adoption with thin rigor.",
    strengths: [],
    risks: [],
    // One LLM roadmap step, so the read-only fallback (RoadmapSteps over report.roadmap) is visible.
    roadmap: [{ title: ROADMAP_TITLE, dimension: "D1", impact: "high", effort: "low", rationale: "r" }],
    discrepancies: [],
    confidence: 0.82,
    scannedAt: "2026-01-15T08:00:00.000Z",
    engine: { provider: "claude-cli", model: "test" },
  } as unknown as ScanReport;
}

// Only the fields PassportHero reads (same fixture shape as ReportView.dom.test.tsx).
const passport = {
  generatedAt: "2026-01-15",
  identity: { license: "MIT" },
  evidence: { source: "scan", confidence: 0.9 },
  stack: { languages: [], frameworks: [], persistence: [], integrations: [], hosting: null },
  automationReadiness: { level: "A2", score: 61 },
  productionReadiness: {
    band: "developing",
    score: 55,
    ci: { level: "basic" },
    tests: { level: "basic" },
    security: { level: "basic" },
    observability: { level: "none" },
    delivery: { migrations: "versioned", iac: false, rollback: false },
  },
} as unknown as AppPassport;

// One prior scan → the trend panel reads "2 scans tracked." once history has genuinely LOADED, which
// is the positive proof that a recommendations failure left the history disposition alone.
const historyBody = {
  repo: { owner: "acme", name: "widget", fullName: "acme/widget" },
  scans: [{ id: "s0", overallScore: 60, scannedAt: "2026-01-01T08:00:00.000Z", level: "L2", dimensions: [] }],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const NETWORK = new TypeError("Failed to fetch");
const thrown = (): Response => {
  throw NETWORK;
};

type Answers = { passport?: () => Response; recs?: () => Response };

/** Routes the four endpoints the tree reads. Defaults are the quiet answers: no saved passport (404),
 *  one prior scan of history, an empty recommendations list, a signed-out viewer for the CTA. */
function stubFetch(a: Answers = {}) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.startsWith("/api/report/passport")) return (a.passport ?? (() => json({}, 404)))();
    if (u.startsWith("/api/recommendations")) return (a.recs ?? (() => json({ items: [] })))();
    if (u.startsWith("/api/history")) return json(historyBody);
    if (u.startsWith("/api/auth/viewer")) return json({ signedIn: false });
    throw new Error(`unexpected fetch ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let warn: MockInstance<typeof console.warn>;
/** Only the report's own doors — anything else that warns is not this contract. */
const reportWarns = () => warn.mock.calls.filter((c) => String(c[0]).startsWith("[report]"));
/** Let every in-flight read settle (the fetch stubs resolve on microtasks; one macrotask drains them). */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

beforeEach(() => {
  nav.query = "";
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ReportView doors — the passport read (the hero)", () => {
  it("a thrown fetch keeps the hero hidden and warns naming the read", async () => {
    stubFetch({ passport: thrown });
    render(<ReportView report={makeReport()} />);

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith("[report] passport read failed; the hero stays hidden:", NETWORK),
    );
    // The degrade itself is unchanged: the report renders, the hero simply does not.
    expect(screen.getByTestId("report")).toBeInTheDocument();
    expect(screen.queryByText("App Readiness Passport")).toBeNull();
  });

  it("an HTTP 500 is a failed read: hero hidden, and the warn names the status", async () => {
    stubFetch({ passport: () => json({ error: "boom" }, 500) });
    render(<ReportView report={makeReport()} />);

    await waitFor(() => expect(reportWarns().some((c) => /passport read failed.*HTTP 500/.test(String(c[0])))).toBe(true));
    expect(screen.queryByText("App Readiness Passport")).toBeNull();
  });

  it("a 404 is an answer (no saved passport): hero hidden, and NO warn", async () => {
    const fetchMock = stubFetch();
    render(<ReportView report={makeReport()} />);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/api/report/passport"))).toBe(true),
    );
    await screen.findByText("2 scans tracked.");
    await settle();
    expect(screen.queryByText("App Readiness Passport")).toBeNull();
    expect(reportWarns()).toEqual([]);
  });

  it("a 503 is the no-database answer (the route's own guard): hero hidden, and NO warn", async () => {
    const fetchMock = stubFetch({ passport: () => json({ error: "Passport export requires a database." }, 503) });
    render(<ReportView report={makeReport()} />);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/api/report/passport"))).toBe(true),
    );
    await screen.findByText("2 scans tracked.");
    await settle();
    expect(screen.queryByText("App Readiness Passport")).toBeNull();
    expect(reportWarns()).toEqual([]);
  });

  it("control: a 200 passport renders the hero quietly — the absence above is the degrade, not a broken tree", async () => {
    stubFetch({ passport: () => json(passport) });
    render(<ReportView report={makeReport()} />);

    expect(await screen.findByText("App Readiness Passport")).toBeInTheDocument();
    await settle();
    expect(reportWarns()).toEqual([]);
  });
});

describe("ReportView doors — the recommendations read (the roadmap)", () => {
  it("a thrown fetch keeps the read-only roadmap and warns naming the read", async () => {
    nav.query = "tab=roadmap";
    stubFetch({ recs: thrown });
    render(<ReportView report={makeReport()} />);

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith("[report] recommendations read failed; read-only roadmap:", NETWORK),
    );
    // recs stays null → RoadmapSteps over the scan's own LLM roadmap, with the exploratory copy.
    expect(screen.getByTestId("report-tab-roadmap")).toBeInTheDocument();
    expect(screen.getByText(/Where trust in AI could grow/)).toBeInTheDocument();
    expect(screen.getByText(ROADMAP_TITLE)).toBeInTheDocument();
  });

  it("an HTTP 500 keeps the read-only roadmap, and the warn names the status", async () => {
    nav.query = "tab=roadmap";
    stubFetch({ recs: () => json({ error: "Failed to load recommendations." }, 500) });
    render(<ReportView report={makeReport()} />);

    await waitFor(() =>
      expect(reportWarns().some((c) => /recommendations read failed.*HTTP 500/.test(String(c[0])))).toBe(true),
    );
    expect(screen.getByText(/Where trust in AI could grow/)).toBeInTheDocument();
    expect(screen.getByText(ROADMAP_TITLE)).toBeInTheDocument();
  });

  it("an empty list is an answer: the same read-only roadmap, and NO warn", async () => {
    nav.query = "tab=roadmap";
    const fetchMock = stubFetch();
    render(<ReportView report={makeReport()} />);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/api/recommendations"))).toBe(true),
    );
    await settle();
    expect(screen.getByText(ROADMAP_TITLE)).toBeInTheDocument();
    expect(reportWarns().filter((c) => String(c[0]).includes("recommendations"))).toEqual([]);
  });

  it("a 503 is the no-database answer (dbGuard): the read-only roadmap, and NO warn", async () => {
    nav.query = "tab=roadmap";
    const fetchMock = stubFetch({ recs: () => json({ error: "no database" }, 503) });
    render(<ReportView report={makeReport()} />);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/api/recommendations"))).toBe(true),
    );
    await settle();
    expect(screen.getByText(ROADMAP_TITLE)).toBeInTheDocument();
    expect(reportWarns()).toEqual([]);
  });

  it.each([
    ["a thrown fetch", thrown],
    ["an HTTP 500", () => json({ error: "boom" }, 500)],
  ])("%s does not touch history's own state — the trend panel still reads as loaded", async (_label, recs) => {
    stubFetch({ recs });
    render(<ReportView report={makeReport()} />);

    await waitFor(() =>
      expect(reportWarns().some((c) => String(c[0]).includes("recommendations read failed"))).toBe(true),
    );
    // History loaded (one prior scan + this one) and its error branch never fired.
    expect(await screen.findByText("2 scans tracked.")).toBeInTheDocument();
    await settle();
    expect(screen.queryByText(/Couldn't load history/)).toBeNull();
    // Nor did the recommendations failure masquerade as a history door.
    expect(warn.mock.calls.some((c) => /history/i.test(String(c[0])))).toBe(false);
  });
});
