import { describe, it, expect } from "vitest";
import { playbookMarkdown } from "./playbook-brief";

describe("playbookMarkdown", () => {
  it("renders title, dimension, summary, steps and an apply ASK", () => {
    const md = playbookMarkdown(
      { title: "Our CI standard", dimId: "D5", summary: "Required checks on every PR.", steps: ["lint", "test", "build"] },
      "CI/CD",
    );
    expect(md).toContain("# Apply playbook: Our CI standard");
    expect(md).toContain("Strengthens D5 (CI/CD).");
    expect(md).toContain("Required checks on every PR.");
    expect(md).toContain("## Steps");
    expect(md).toContain("- lint");
    expect(md).toContain("## Ask");
    expect(md).toMatch(/open a pull request/);
  });

  it("omits the summary and steps sections when empty", () => {
    const md = playbookMarkdown({ title: "T", dimId: "D1", summary: "", steps: [] }, "Foundations");
    expect(md).not.toContain("## Steps");
    expect(md).toContain("## Ask");
  });
});
