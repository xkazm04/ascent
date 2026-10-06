// @vitest-environment jsdom
//
// The Knowledge base's section switch: `Subjects` clears `section`, `UI surfaces` sets it, and both
// are a clean view change (tab-scoped params dropped) that keeps the period / scope params.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { KnowledgeSectionSwitch } from "./KnowledgeSectionSwitch";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=knowledge&section=surfaces&subject=table&technique=pagination&range=90d"),
}));

describe("KnowledgeSectionSwitch", () => {
  it("links Subjects without a section and UI surfaces with one, dropping subject and technique", () => {
    render(<KnowledgeSectionSwitch slug="acme" active="surfaces" />);
    const subjects = new URL(screen.getByRole("link", { name: "Subjects" }).getAttribute("href")!, "https://x.test");
    expect(subjects.searchParams.get("tab")).toBe("knowledge");
    expect(subjects.searchParams.has("section")).toBe(false);
    expect(subjects.searchParams.has("subject")).toBe(false);
    expect(subjects.searchParams.get("range")).toBe("90d");
    const surfaces = new URL(screen.getByRole("link", { name: "UI surfaces" }).getAttribute("href")!, "https://x.test");
    expect(surfaces.searchParams.get("section")).toBe("surfaces");
    expect(surfaces.searchParams.has("technique")).toBe(false);
  });

  it("marks the active section", () => {
    render(<KnowledgeSectionSwitch slug="acme" active="surfaces" />);
    expect(screen.getByRole("link", { name: "UI surfaces" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Subjects" }).getAttribute("aria-current")).toBeNull();
  });
});
