// The brief is the entire interface to an agent nobody watches, so what is pinned here is what the
// golden path (remediation-handoff / single-artifact-prompt-construction) says must hold: it is
// deterministic, every stable id appears verbatim, each stage names its own commands, and the
// construction path reaches no clock and no random source.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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

describe("briefDigest", () => {
  it("is sha256: plus 16 hex chars, stable for the same text", () => {
    const d = briefDigest("hello");
    expect(d).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(d).toBe(briefDigest("hello"));
    expect(d).not.toBe(briefDigest("hello!"));
  });
});
