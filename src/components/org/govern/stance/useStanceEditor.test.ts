// The stance editor's pure form↔stance codecs (W3) — the piece worth pinning without a DOM
// (mirrors how GatePolicyEditor's appliesWhen is tested as a pure export): the POST payload built
// from form state, and the round-trip back when the form re-seeds from the server's echo.

import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { formFromStance, parseList, stanceFromForm } from "./useStanceEditor";
import type { AiStance } from "@/lib/types";

describe("parseList", () => {
  it("splits on newlines and commas, trimming and dropping empties", () => {
    expect(parseList("Claude Code\n Copilot , ,\n")).toEqual(["Claude Code", "Copilot"]);
    expect(parseList("")).toEqual([]);
  });
});

describe("stanceFromForm / formFromStance", () => {
  const form = {
    tools: "Claude Code\nCopilot",
    models: "claude-opus",
    zones: [
      { repoGlobs: "acme/billing-*", pathGlobs: "prisma/migrations/**, crypto/**", reason: " PCI " },
      { repoGlobs: "", pathGlobs: "", reason: "empty (dropped)" },
    ],
    reviews: { T2: "Two approvals.", T1: "" } as const,
    requireTrailer: true,
    requireHumanApproval: false,
  };

  it("assembles the POST payload, dropping empty zones and blank tier reviews", () => {
    const s = stanceFromForm(form);
    expect(s.permittedTools).toEqual(["Claude Code", "Copilot"]);
    expect(s.noAiZones).toEqual([
      { repoGlobs: ["acme/billing-*"], pathGlobs: ["prisma/migrations/**", "crypto/**"], reason: "PCI" },
    ]);
    expect(s.reviewTiers).toEqual([{ tier: "T2", review: "Two approvals." }]);
    expect(s.provenance).toEqual({ requireTrailer: true, requireHumanApproval: false });
  });

  it("round-trips through formFromStance (the server-echo re-seed path)", () => {
    const stance = stanceFromForm(form) as AiStance;
    const seeded = formFromStance(stance);
    expect(stanceFromForm({ ...seeded, requireTrailer: true, requireHumanApproval: false })).toEqual(stance);
  });

  it("formFromStance(null) yields a blank form", () => {
    const f = formFromStance(null);
    expect(f).toEqual({ tools: "", models: "", zones: [], reviews: {} });
  });
});
