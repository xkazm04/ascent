// @vitest-environment jsdom
//
// export-1 (challenge-2026-10-22d): the report header's briefing composer. Pinned: the chip copies
// composeBriefing(report, selection, lifts) - the endpoint's own call, so the clipboard equals the body
// of GET briefingHref(...) - the Copy URL is that href, the readout is computed from the exact copied
// string, and with no selection and no lifts the chip copies today's reportLlmMarkdown(report) bytes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { DimensionId, ScanReport } from "@/lib/types";
import type { LiftDistribution } from "@/lib/outcomes/aggregate";
import { reportLlmMarkdown } from "@/lib/report/llm-markdown";
import { recommendationMatchKey } from "@/lib/report/rec-identity";
import { briefingHref, briefingPreview, composeBriefing } from "@/lib/report/briefing-scope";
import { BriefingComposer } from "./BriefingComposer";

const IDS = ["D1", "D3", "D9"] as DimensionId[];
const REPORT = {
  repo: { owner: "acme", name: "app", url: "https://github.com/acme/app", headSha: "sha" },
  overallScore: 55,
  level: { id: "L3", name: "Practicing" },
  archetype: "team",
  adoptionScore: 50,
  rigorScore: 60,
  posture: { id: "ai-native" },
  dimensions: IDS.map((id) => ({ id, name: `Dim ${id}`, weight: 0.3, score: 40, summary: `s-${id}`, evidence: [], gaps: [`gap-${id}`] })),
  headline: "h",
  strengths: [],
  risks: [],
  roadmap: IDS.map((id) => ({ title: `Fix ${id}`, dimension: id, impact: "high", effort: "low", rationale: `why-${id}` })),
  confidence: 0.8,
  scannedAt: "2026-10-01T00:00:00.000Z",
  engine: { provider: "bedrock", model: "m" },
} as unknown as ScanReport;

const key = recommendationMatchKey("D3", "Fix D3");
const LIFTS = new Map<string, LiftDistribution>([[key, {
  identityKey: key, dimId: "D3", n: 12, orgs: 1, medianDim: 6, p25: 3, p75: 9, medianOverall: 2,
  instrument: { rubricVersion: "r10", engineProvider: "bedrock" },
}]]);

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

const openScope = () => fireEvent.click(screen.getByRole("button", { name: /Scope the briefing/ }));

describe("BriefingComposer", () => {
  it("guard: unscoped, no lifts -> the chip copies reportLlmMarkdown(report) byte for byte", async () => {
    render(<BriefingComposer report={REPORT} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy the acme\/app maturity briefing/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(reportLlmMarkdown(REPORT)));
  });

  it("the page's lifts ride into the copied text as the measured clause", async () => {
    render(<BriefingComposer report={REPORT} lifts={LIFTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy the acme\/app maturity briefing/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain("   - _measured:_ D3 +6 median");
    expect(writeText.mock.calls[0][0]).toBe(reportLlmMarkdown(REPORT, { lifts: LIFTS }));
  });

  it("selecting D3 then copying -> the scoped text the endpoint serves; Copy URL is its href", async () => {
    render(<BriefingComposer report={REPORT} />);
    openScope();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /D3/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Copy the scoped briefing/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe(composeBriefing(REPORT, ["D3"]));
    fireEvent.click(within(dialog).getByRole("button", { name: /Copy the briefing URL/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    const url = String(writeText.mock.calls[1][0]);
    expect(url.endsWith(briefingHref({ repo: "acme/app@sha", dims: ["D3"] }))).toBe(true);
    expect(url).toContain("/api/report/llm?repo=acme%2Fapp%40sha&dims=D3");
  });

  it("the readout is computed from the exact string that will be copied", () => {
    render(<BriefingComposer report={REPORT} />);
    openScope();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /D3/ }));
    const p = briefingPreview(composeBriefing(REPORT, ["D3"]));
    const readout = within(dialog).getByTestId("briefing-preview").textContent ?? "";
    expect(readout).toContain(`${p.lines} lines`);
    expect(readout).toContain(`${p.approxTokens.toLocaleString("en-US")} tokens`);
    expect(readout).toContain("1 of 3 dimensions");
    expect(readout).not.toContain(String.fromCharCode(0x2014));
  });

  it("forwards the page's ?org hint into the URL", async () => {
    render(<BriefingComposer report={REPORT} org="rebrand" />);
    openScope();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Copy the briefing URL/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String(writeText.mock.calls[0][0])).toContain("/api/report/llm?repo=acme%2Fapp%40sha&org=rebrand");
  });
});
