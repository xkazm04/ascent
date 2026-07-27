// @vitest-environment jsdom
//
// The report-header onboarding-skill control. Two things are load-bearing and pinned here:
//
// 1. The DEFAULT pill must stay a plain one-click download with NO selection params — the picker is
//    additive, and a regression that leaked a partial `?dims=` into the default link would silently
//    narrow every maintainer's skill (and the generation-history record it dedups on).
// 2. The picker's download link must encode the chosen dimensions in the exact `?dims=D2,D9` contract
//    the route validates. The route 400s on an unknown id, so a drifted client contract is a broken
//    download, not a degraded one.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { DimensionResult } from "@/lib/types";
import { SkillDownload } from "./SkillDownload";

const DIMS = [
  { id: "D1", name: "Agent guidance", score: 90 },
  { id: "D2", name: "Test coverage", score: 45 },
  { id: "D9", name: "Security", score: 55 },
] as unknown as DimensionResult[];

const href = (name: string | RegExp) => screen.getByRole("link", { name }).getAttribute("href") ?? "";

describe("SkillDownload", () => {
  it("keeps the default pill a bare download — no dims param", () => {
    render(<SkillDownload repoParam="acme/api@abc123" dimensions={DIMS} />);
    const link = href(/Onboarding skill/);
    expect(link).toBe("/api/report/skill?repo=acme%2Fapi%40abc123");
    expect(link).not.toContain("dims");
  });

  it("encodes the picked dimensions as ?dims=D2,D9 in the picker's download link", () => {
    render(<SkillDownload repoParam="acme/api" dimensions={DIMS} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose tracks" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /D2/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /D9/ }));

    expect(href(/Download SKILL.md/)).toBe("/api/report/skill?repo=acme%2Fapi&dims=D2%2CD9");
  });

  it("offers a refinement pick on an ALREADY-STRONG dimension (the point of the multiselect)", () => {
    render(<SkillDownload repoParam="acme/api" dimensions={DIMS} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose tracks" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /D1/ })); // D1 scores 90 — not a gap
    expect(href(/Download SKILL.md/)).toContain("dims=D1");
  });

  it("falls back to the auto selection (no dims) when nothing is picked", () => {
    render(<SkillDownload repoParam="acme/api" dimensions={DIMS} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose tracks" }));
    expect(href(/Download SKILL.md/)).toBe("/api/report/skill?repo=acme%2Fapi");
  });

  it("renders only the plain pill (no picker) when the report carries no dimensions", () => {
    render(<SkillDownload repoParam="acme/api" />);
    expect(screen.getByRole("link", { name: /Onboarding skill/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose tracks" })).toBeNull();
  });
});
