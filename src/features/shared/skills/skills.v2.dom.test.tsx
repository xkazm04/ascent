// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SkillRow } from "@/lib/db";
import type { SkillTokenScope } from "@/lib/db";
import type { SkillUsage } from "@/lib/org/skill-usage";
import { ApiTokensPanelV2 } from "./ApiTokensPanel.v2";
import { SkillsPanelV2 } from "./SkillsPanel.v2";

function skill(over: Partial<SkillRow> = {}): SkillRow {
  return {
    id: "s1",
    name: "review",
    description: "Review a change",
    content: "body",
    category: "workflow",
    tags: [],
    frontmatter: { name: "review", description: "d", category: "workflow", tags: [], cadenceDays: null },
    version: 1,
    contentHash: "sha256-n1:aa",
    downloadCount: 0,
    adoptionCount: 0,
    origin: "hosted",
    registryPath: null,
    registryVersion: null,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    ...over,
  };
}

const unmeasured: SkillUsage = {
  skillId: "s1",
  verdict: "dormant",
  state: "unmeasured",
  lastUsedAt: null,
  lastUsedType: null,
  lastUsedSource: null,
  daysSinceUse: null,
  useCount: 0,
  invokes: 0,
  eventCount: 0,
  anchorAt: "2026-01-01T00:00:00.000Z",
  ageDays: 4,
  windowDays: 30,
};

const SCOPES = ["skills:read", "mcp:read"] as const satisfies readonly SkillTokenScope[];

describe("skills prism composition", () => {
  it("renders an unmeasured skill as not measured, on a pressable row", () => {
    render(
      <SkillsPanelV2
        slug="kiro"
        initial={[skill()]}
        categories={["workflow"]}
        adoption={{}}
        usage={{ s1: unmeasured }}
        outcomes={{}}
        repoOptions={["acme/app"]}
        isAdmin={false}
        registryBase={null}
      />,
    );
    expect(screen.getByRole("button", { name: /review/i })).toBeInTheDocument();
    expect(screen.getAllByText("not measured").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no denominator/)).not.toBeInTheDocument();
    expect(screen.getByText(/Ran is not measured/)).toBeInTheDocument();
    expect(document.getElementById("skill-filter-search")).not.toBeNull();
  });

  it("hides the unmeasured caveats once adoption and runs are counted", () => {
    render(
      <SkillsPanelV2
        slug="kiro"
        initial={[skill()]}
        categories={["workflow"]}
        adoption={{}}
        usage={{ s1: { ...unmeasured, state: "abandoned", invokes: 1, useCount: 1, eventCount: 1 } }}
        outcomes={{}}
        repoOptions={["acme/app"]}
        isAdmin={false}
        registryBase={null}
      />,
    );
    expect(screen.queryByText(/no denominator/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ran is not measured/)).not.toBeInTheDocument();
    expect(screen.getAllByText("none of 1").length).toBeGreaterThan(0);
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
  });

  it("keeps the token create control's disabled rule and the default scope", () => {
    render(<ApiTokensPanelV2 slug="kiro" initial={[]} scopes={SCOPES} />);
    expect(document.getElementById("skill-token-name")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Create token" })).toBeDisabled();
    expect(document.getElementById("skill-token-scope-mcp-read")).toBeChecked();
    expect(document.getElementById("skill-token-scope-skills-read")).not.toBeChecked();
  });
});
