import { describe, it, expect } from "vitest";
import { buildArtifact } from "./practice-artifact";
import { PRACTICES } from "@/lib/practices";

const ctx = { fullName: "acme/api", name: "api", description: "Billing API", primaryLanguage: "TypeScript", defaultBranch: "main" };

describe("buildArtifact", () => {
  it("builds a tailored AGENTS.md for agent-guidance with the repo's commands", () => {
    const a = buildArtifact("agent-guidance", ctx)!;
    expect(a.path).toBe("AGENTS.md");
    expect(a.body).toContain("npm test");
    expect(a.body).toContain("Billing API");
    expect(a.branch).toBe("ascent/agent-guidance");
    expect(a.prTitle).toContain("Agent guidance");
  });

  it("emits a language-appropriate CI workflow", () => {
    const node = buildArtifact("ci-gates", ctx)!;
    expect(node.path).toBe(".github/workflows/ci.yml");
    expect(node.body).toContain("setup-node");
    const go = buildArtifact("ci-gates", { ...ctx, primaryLanguage: "Go" })!;
    expect(go.body).toContain("setup-go");
    expect(go.body).toContain("go test ./...");
  });

  it("produces a real artifact for every catalogued practice", () => {
    for (const p of PRACTICES) {
      const a = buildArtifact(p.id, ctx);
      expect(a, `practice ${p.id} should yield an artifact`).not.toBeNull();
      expect(a!.path.length).toBeGreaterThan(0);
      expect(a!.body.length).toBeGreaterThan(40);
    }
  });

  it("returns null for an unknown practice", () => {
    expect(buildArtifact("nope", ctx)).toBeNull();
  });

  it("degrades to placeholders when repo context is sparse", () => {
    const a = buildArtifact("agent-guidance", { fullName: "x/y", name: "y" })!;
    expect(a.body).toContain("<install deps>");
    expect(a.body).toContain("TODO");
  });
});
