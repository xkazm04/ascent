// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryCoverageV2 } from "./MemoryCoverage.v2";
import { MemoryRowsV2 } from "./MemoryRows.v2";
import { MemoryAuthorFieldsV2 } from "./MemoryAuthorFields.v2";
import type { MemoryCoverage } from "@/lib/memory/coverage";
import type { MemoryRow } from "@/lib/db";
import type { MemoryFormState } from "./MemoryTypes";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

afterEach(() => cleanup());

function coverage(overrides: Partial<MemoryCoverage>): MemoryCoverage {
  return { reposWithFreshMemory: 0, totalTrackedRepos: 0, coveragePct: 0, staleRepos: [], windowDays: 30, ...overrides };
}

function row(over: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: "m1",
    namespace: "acme/api",
    content: "CI runs on Node 18",
    kind: "procedural",
    visibility: "shared",
    source: "",
    confidence: 0.6,
    tags: [],
    supersededBy: null,
    version: 1,
    accessCount: 2,
    citedCount: 0,
    notUsefulCount: 0,
    expiresAt: null,
    origin: "hosted",
    registryPath: null,
    createdBy: "alice",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...over,
  };
}

const form: MemoryFormState = {
  content: "",
  kind: "semantic",
  namespace: "",
  visibility: "shared",
  source: "",
  confidence: 1,
  tagsText: "",
};

describe("MemoryCoverageV2", () => {
  it("shows an empty fleet as not measured, not as 0% or 100%", () => {
    render(<MemoryCoverageV2 coverage={coverage({})} />);
    expect(screen.getByRole("img", { name: "Memory coverage, not measured" })).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("keeps a measured 0% in paper and names a never-recorded repo", () => {
    const { container } = render(
      <MemoryCoverageV2
        coverage={coverage({
          totalTrackedRepos: 1,
          coveragePct: 0,
          staleRepos: [{ fullName: "acme/api", lastMemoryAt: null }],
        })}
      />,
    );
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("never")).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/text-red|text-orange|text-emerald/);
  });
});

const rowProps = {
  memories: [row(), row({ id: "m2", content: "Second note" })],
  viewerLogin: "alice",
  isAdmin: false,
  onArchive: () => {},
  canWrite: false,
  onCorrect: () => {},
  registryBase: null,
};

describe("MemoryRowsV2", () => {
  it("presses a row with its id", () => {
    const onOpen = vi.fn();
    render(<MemoryRowsV2 {...rowProps} sceneId={null} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /CI runs on Node 18/ }));
    expect(onOpen).toHaveBeenCalledWith("m1");
  });

  it("shows that memory as a level and leaves it on Esc", () => {
    const onOpen = vi.fn();
    render(<MemoryRowsV2 {...rowProps} sceneId="m1" onOpen={onOpen} />);
    expect(screen.getByRole("button", { name: "All memories" })).toBeInTheDocument();
    expect(screen.getByText("Medium trust")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onOpen).toHaveBeenCalledWith(null);
  });
});

describe("MemoryAuthorFieldsV2", () => {
  it("keeps the kind control id", () => {
    render(<MemoryAuthorFieldsV2 kinds={["semantic", "episodic"]} namespaces={["platform"]} form={form} setForm={() => {}} />);
    expect(document.getElementById("mem-kind")).toBeInstanceOf(HTMLSelectElement);
    expect(document.getElementById("mem-namespace")).toBeInstanceOf(HTMLInputElement);
    expect(document.getElementById("mem-confidence")).toBeInstanceOf(HTMLSelectElement);
    expect(document.getElementById("mem-visibility")).toBeInstanceOf(HTMLSelectElement);
    expect(document.getElementById("mem-source")).toBeInstanceOf(HTMLInputElement);
    expect(document.getElementById("mem-tags")).toBeInstanceOf(HTMLInputElement);
  });
});
