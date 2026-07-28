// @vitest-environment jsdom
// Pins the cold-permalink gate + its conversion teaser (G6-26). The gate is what an ANONYMOUS visitor
// sees for a never-scanned repo, so the invariants under test are honesty invariants, not layout:
//   • it renders with no session, no org, no credits and issues no network call on mount;
//   • it shows what a scan PRODUCES (the 9 dimensions, the L1–L5 ladder) and NEVER a score-shaped
//     number, sample ring or "typical result" for a repo that has not been scanned;
//   • it discloses the terms up front — free/no account, minutes not seconds, capped allowance
//     (so the quota sign-in wall is never a surprise), public saved report, nothing cloned;
//   • "Scan now" still hands ReportClient the FULL ref including a pinned @sha.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ColdScanGate } from "@/components/report/ColdScanGate";
import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

// The real ReportClient drags in the whole live-scan machinery (SSE, search params); the gate's
// contract with it is just "mounted with this exact repo ref".
vi.mock("@/components/report/ReportClient", () => ({
  ReportClient: ({ repo }: { repo: string }) => <div data-testid="report-client">{repo}</div>,
}));

beforeEach(() => vi.unstubAllGlobals());

describe("ColdScanGate — anonymous cold permalink", () => {
  it("renders for a visitor with no session/org and makes no network call on mount", () => {
    const fetchMock = vi.fn(() => {
      throw new Error("ColdScanGate must not fetch on mount");
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ColdScanGate repo="sindresorhus/slugify" />);

    expect(screen.getByRole("heading", { name: /no report yet for sindresorhus\/slugify/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /scan sindresorhus\/slugify now/i })).toBeInTheDocument();
    expect(screen.getByTestId("cold-scan-teaser")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows no score-shaped number for an unscanned repo", () => {
    render(<ColdScanGate repo="sindresorhus/slugify" />);
    const text = document.body.textContent ?? "";

    // No "NN/100", no percentage, and no sample/typical-score framing anywhere on the gate.
    expect(text).not.toMatch(/\/\s*100\b/);
    expect(text).not.toMatch(/%/);
    expect(text).not.toMatch(/\b(sample|example|typical|average|estimated)\s+(score|result|rating)\b/i);
    expect(text).not.toMatch(/\bscores?\s+\d/i);
    // The only numerals on the panel are the rubric's own shape (9 dimensions / 5 levels) and the
    // L1–L5 ids — never a 0–100 figure presented as this repo's standing.
    const numerals = text.match(/\d+/g) ?? [];
    for (const n of numerals) expect(Number(n)).toBeLessThanOrEqual(LEVELS.length * 2);
  });

  it("teases what a scan produces: every rubric dimension and the full level ladder", () => {
    render(<ColdScanGate repo="sindresorhus/slugify" />);
    const teaser = screen.getByTestId("cold-scan-teaser");

    for (const d of DIMENSIONS) expect(teaser.textContent).toContain(d.name);
    for (const l of LEVELS) expect(teaser.textContent).toContain(`${l.id} ${l.name}`);
    expect(teaser.textContent).toContain(`${DIMENSIONS.length}`);
  });

  it("discloses cost, wait and the allowance wall before the visitor commits", () => {
    render(<ColdScanGate repo="sindresorhus/slugify" />);
    const text = document.body.textContent ?? "";

    expect(text).toMatch(/free for public repositor/i);
    expect(text).toMatch(/no account/i);
    expect(text).toMatch(/minutes, not seconds/i);
    expect(text).toMatch(/capped at a few per month/i);
    expect(text).toMatch(/asked to sign in/i); // the quota wall is announced, not sprung
    expect(text).toMatch(/never copied|nothing is cloned/i);
    expect(text).toMatch(/saved at this URL/i);
    // The old copy under-promised the wait ("about a minute") — that must not come back.
    expect(text).not.toMatch(/about a minute/i);
  });

  it("offers a real finished report as the no-wait alternative", () => {
    render(<ColdScanGate repo="sindresorhus/slugify" />);
    const demo = screen.getByRole("link", { name: /explore the live demo/i });
    expect(demo.getAttribute("href")).toMatch(/^\/org\/[^/]+$/);
  });

  it("hands ReportClient the full pinned ref when the permalink carries an @sha", () => {
    render(<ColdScanGate repo="facebook/react@abc1234def" />);

    // The visible title/CTA drop the sha to the short form, but the scan gets the full ref.
    expect(screen.getByRole("heading", { name: /no report yet for facebook\/react$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /scan facebook\/react @ abc1234 now/i }));

    expect(screen.getByTestId("report-client")).toHaveTextContent("facebook/react@abc1234def");
  });
});
