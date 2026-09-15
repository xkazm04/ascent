// The brief is the entire interface to an agent nobody watches, so what is pinned here is what the
// golden path (remediation-handoff / single-artifact-prompt-construction) says must hold: it is
// deterministic, every stable id appears verbatim, each stage names its own commands, and the
// construction path reaches no clock and no random source.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { KnowledgeContextRow } from "@/lib/org/knowledge-shape";
import { DISPATCH_TRAILER_KEY, briefDigest, buildRegistryBrief, type RegistryBriefInput } from "./dispatch-brief";

const base: RegistryBriefInput = {
  dispatchId: "d-1234-abcd",
  repoFullName: "acme/api",
  defaultBranch: "main",
  stage: "conform",
  subjects: ["quality-gates", "Feature_Flags.v2", "remediation-handoff"],
  registry: { fullName: "acme/ai-registry", localHint: "../ai-registry" },
  domains: ["software-engineering"],
};

describe("buildRegistryBrief", () => {
  it("is deterministic — two calls with the same input are byte-identical", () => {
    expect(buildRegistryBrief(base)).toBe(buildRegistryBrief({ ...base, subjects: [...base.subjects] }));
  });

  it("carries the dispatch id verbatim, in the header and as the commit trailer", () => {
    const text = buildRegistryBrief(base);
    expect(text).toContain("Dispatch id: `d-1234-abcd`");
    expect(text).toContain(`${DISPATCH_TRAILER_KEY}: d-1234-abcd`);
  });

  it("names every subject slug verbatim, one /conform line each, in the order given", () => {
    const text = buildRegistryBrief(base);
    const lines = text.split("\n").filter((l) => l.startsWith("- `/conform --subject "));
    expect(lines).toEqual([
      "- `/conform --subject quality-gates`",
      "- `/conform --subject Feature_Flags.v2`",
      "- `/conform --subject remediation-handoff`",
    ]);
    expect(text).toContain("budget: 3");
    expect(text).toContain("`evaluatedAgainst`");
  });

  it("populate names the skill, the map builder and a commit of both files", () => {
    const text = buildRegistryBrief({ ...base, stage: "populate", subjects: [] });
    expect(text).toContain("`/project-populate contexts`");
    expect(text).toContain("node ../ai-registry/scripts/build-registry-map.mjs --project api");
    expect(text).toContain("Commit both files.");
    expect(text).not.toContain("/conform");
  });

  it("map names the builder, the manifest's domains when known, and a commit of the map", () => {
    const text = buildRegistryBrief({ ...base, stage: "map", subjects: [] });
    expect(text).toContain("node ../ai-registry/scripts/build-registry-map.mjs --project api");
    expect(text).toContain("`knowledge.domains`");
    expect(text).toContain("software-engineering");
    expect(text).toContain("Commit `.ai/registry-map.json`.");
    expect(text).not.toContain("/project-populate");
  });

  it("omits the Domains line rather than printing an empty label when domains are unknown", () => {
    const text = buildRegistryBrief({ ...base, stage: "map", subjects: [], domains: [] });
    expect(text).not.toContain("Domains:");
    expect(text).toContain("`knowledge.domains`");
  });

  it("ignores subjects for populate / map", () => {
    const text = buildRegistryBrief({ ...base, stage: "map" });
    expect(text).not.toContain("Subjects (");
    expect(text).not.toContain("quality-gates");
  });

  it("states the working rules and the return contract against the repo's own default branch", () => {
    const text = buildRegistryBrief({ ...base, defaultBranch: "develop" });
    expect(text).toContain("Never commit to `develop` directly.");
    expect(text).toContain("open a pull request to `develop`");
    expect(text).toContain("sweeping the committed `.ai/registry-map.json`");
    expect(text).toContain("The standard does not bend to the code");
    expect(text).toContain("Never edit a guard test");
    expect(text).toContain("`AGENTS.md` / `CLAUDE.md`");
  });

  it("reaches no clock and no random source (asserted on the module text)", () => {
    const src = readFileSync(new URL("./dispatch-brief.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\bnew Date\b|Date\.now|Math\.random|randomUUID/);
  });
});

describe("subscribed contexts and context-map churn (knowledge-context-matrix)", () => {
  const row = (name: string, over: Partial<KnowledgeContextRow> = {}): KnowledgeContextRow => ({
    name,
    group: "Fleet",
    state: "conformant",
    stale: false,
    judgedRevision: null,
    arrived: false,
    ...over,
  });

  it("lists each picked subject's context rows in the fold's order, with the subject's revision line when known", () => {
    const text = buildRegistryBrief({
      ...base,
      subjects: ["quality-gates", "remediation-handoff"],
      subjectContexts: [
        {
          slug: "remediation-handoff",
          revision: null,
          changedAt: null,
          contextRows: [],
        },
        {
          slug: "quality-gates",
          revision: 14,
          changedAt: "2026-09-01",
          contextRows: [
            row("Fleet/CI Gate", { state: "deviation", stale: true, judgedRevision: 12 }),
            row("Fleet/Rescan", { state: "conformant", judgedRevision: 14 }),
            row("Fleet/Alerts", { group: null, state: "unknown", arrived: true }),
          ],
        },
      ],
    });
    const start = text.indexOf("## Subscribed contexts");
    const end = text.indexOf("## Return contract");
    expect(start).toBeGreaterThan(text.indexOf("## Do this"));
    expect(text.slice(start, end).trimEnd().split("\n")).toEqual([
      "## Subscribed contexts",
      "",
      "### quality-gates — r14 · 2026-09-01",
      "- Fleet/CI Gate (Fleet) — deviation, stale, judged at r12",
      "- Fleet/Rescan (Fleet) — conformant, judged at r14",
      "- Fleet/Alerts — unknown, new",
      "",
      "### remediation-handoff",
      "- (no subscribed contexts in the map)",
    ]);
  });

  it("omits the section entirely when the caller gave no rows, and for non-conform stages", () => {
    expect(buildRegistryBrief(base)).not.toContain("## Subscribed contexts");
    expect(buildRegistryBrief({ ...base, stage: "map", subjects: [], subjectContexts: [{ slug: "x", revision: 1, changedAt: null, contextRows: [row("a")] }] })).not.toContain(
      "## Subscribed contexts",
    );
  });

  it("a map brief states the churn counts, and the two revisions only when the map is behind", () => {
    const repo = { orphaned: 2, arrived: 3, renamed: 1, contextMapRevision: "aaa111", repoContextMapRevision: "bbb222", mapBehind: true };
    const behind = buildRegistryBrief({ ...base, stage: "map", subjects: [], repo });
    expect(behind).toContain("## Context map");
    expect(behind).toContain("- Orphaned verdicts: 2 · arrived contexts: 3 · renamed contexts: 1");
    expect(behind).toContain("built from revision `aaa111`, `context-map.json` is now `bbb222`");

    const current = buildRegistryBrief({ ...base, stage: "map", subjects: [], repo: { ...repo, repoContextMapRevision: "aaa111", mapBehind: false } });
    expect(current).toContain("- Orphaned verdicts: 2 · arrived contexts: 3 · renamed contexts: 1");
    expect(current).not.toContain("moved after the registry map was built");

    // Conform ignores the churn block; without `repo` a map brief has no such section at all.
    expect(buildRegistryBrief({ ...base, repo })).not.toContain("## Context map");
    expect(buildRegistryBrief({ ...base, stage: "map", subjects: [] })).not.toContain("## Context map");
  });

  it("stays deterministic with the new sections", () => {
    const input: RegistryBriefInput = { ...base, subjectContexts: [{ slug: "quality-gates", revision: 3, changedAt: "2026-08-01", contextRows: [row("a", { judgedRevision: 2 })] }] };
    expect(buildRegistryBrief(input)).toBe(buildRegistryBrief({ ...input }));
  });
});

describe("briefDigest", () => {
  it("is sha256: plus 16 hex chars, stable for the same text", () => {
    const d = briefDigest("hello");
    expect(d).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(d).toBe(briefDigest("hello"));
    expect(d).not.toBe(briefDigest("hello!"));
  });
});
