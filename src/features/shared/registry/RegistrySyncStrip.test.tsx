// @vitest-environment jsdom
//
// The strip is the one sentence Skills, Memory and Practices all say about where their content lives.
// Two states, and the difference matters: unmapped must read as a POINTER (never a gate, and never a
// claim that a registry exists), mapped must name the repo, when it was last read, and what it holds.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegistrySyncStrip } from "./RegistrySyncStrip";
import { UNMAPPED_SYNC, type RegistrySync } from "@/lib/org/registry-sync";

const MAPPED: RegistrySync = {
  mapped: true,
  fullName: "acme/ai-registry",
  url: "https://github.com/acme/ai-registry",
  defaultBranch: "main",
  lastIndexedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  counts: { skills: 3, practices: 2, memory: 4, lessons: 1 },
  status: "indexed",
};

describe("RegistrySyncStrip — nothing mapped", () => {
  it("points at the Registry tab and names the asking tab's own noun", () => {
    render(<RegistrySyncStrip sync={UNMAPPED_SYNC} slug="acme" artifact="skills" />);
    expect(screen.getByText(/Nothing is backed by a registry yet/i)).toBeTruthy();
    expect(screen.getByText(/Skills/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /set up the registry/i });
    expect(link.getAttribute("href")).toContain("tab=registry");
  });

  it("never asserts a repo that does not exist", () => {
    const { container } = render(<RegistrySyncStrip sync={UNMAPPED_SYNC} slug="acme" artifact="memory" />);
    expect(container.innerHTML).not.toContain("github.com");
  });

  it("says the same thing on every consumer tab, with only the noun changing", () => {
    for (const [artifact, noun] of [
      ["skills", "Skills"],
      ["practices", "Practices"],
      ["memory", "Memory"],
    ] as const) {
      const { container, unmount } = render(<RegistrySyncStrip sync={UNMAPPED_SYNC} slug="acme" artifact={artifact} />);
      expect(container.textContent).toContain(noun);
      expect(container.textContent).toMatch(/lives only in ascent/i);
      unmount();
    }
  });
});

describe("RegistrySyncStrip — mapped", () => {
  it("names the repo, links it, and reports what the last index pass read", () => {
    render(<RegistrySyncStrip sync={MAPPED} slug="acme" artifact="practices" />);
    const repo = screen.getByRole("link", { name: "acme/ai-registry" });
    expect(repo.getAttribute("href")).toBe("https://github.com/acme/ai-registry");
    expect(repo.getAttribute("target")).toBe("_blank");
    // "Backed by" is its own <span>; the sentence is the paragraph that wraps it.
    const text = screen.getByText(/Backed by/i).closest("p")?.textContent ?? "";
    expect(text).toMatch(/indexed/i);
    expect(text).toMatch(/3 skills/);
    expect(text).toMatch(/2 practices/);
    expect(text).toMatch(/4 memory notes/);
    expect(text).toMatch(/1 lessons?/);
  });

  it("distinguishes mapped-but-never-indexed from indexed, instead of implying a read happened", () => {
    render(<RegistrySyncStrip sync={{ ...MAPPED, lastIndexedAt: null, status: "scaffold_pr_open" }} slug="acme" artifact="skills" />);
    expect(screen.getByText(/mapped, not indexed yet/i)).toBeTruthy();
  });

  it("omits the lessons clause when there are none, rather than printing a zero", () => {
    render(<RegistrySyncStrip sync={{ ...MAPPED, counts: { ...MAPPED.counts, lessons: 0 } }} slug="acme" artifact="skills" />);
    expect(screen.getByText(/Backed by/i).closest("p")?.textContent ?? "").not.toMatch(/lessons/);
  });
});
