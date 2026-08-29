// Reflect-as-PR (#36). The note file's contract is the whole point: a reviewer must be able to open
// every path it cites, which is why `supersedes` is paths and never DB uuids.

import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockOpenPr } = vi.hoisted(() => ({ mockOpenPr: vi.fn() }));
vi.mock("@/lib/github/write", () => ({ openDraftPr: mockOpenPr }));

import { AppApiError } from "@/lib/github/app";
import { buildMemoryNoteFile, memoryPrBranch, proposeMemoryPr, slugifyNoteName } from "./memory-pr";

const note = (over: Partial<Parameters<typeof buildMemoryNoteFile>[0]> = {}) => ({
  kind: "summary",
  namespace: "acme/api",
  confidence: 0.6,
  content: "The three notes agree: the gate is the control.",
  supersedes: ["memory/decision/old-a.md", "memory/decision/old-b.md"],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockOpenPr.mockResolvedValue({ url: "https://github.com/acme/ai-registry/pull/7", number: 7, branch: "b", reused: false });
});

describe("buildMemoryNoteFile", () => {
  it("cites the notes it replaces by PATH, never by uuid", () => {
    const body = buildMemoryNoteFile(note());
    expect(body).toContain("supersedes: memory/decision/old-a.md, memory/decision/old-b.md");
    // A uuid in a reviewer's diff is an opaque token they cannot open.
    expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("stamps its own provenance so a later index pass knows who wrote it", () => {
    expect(buildMemoryNoteFile(note())).toContain("source: ascent:reflection");
  });

  it("omits `supersedes` entirely when the note replaces nothing", () => {
    expect(buildMemoryNoteFile(note({ supersedes: [] }))).not.toContain("supersedes");
  });

  it("omits an absent namespace rather than writing an empty one", () => {
    expect(buildMemoryNoteFile(note({ namespace: null }))).not.toContain("namespace");
  });

  it("clamps confidence into [0,1]", () => {
    expect(buildMemoryNoteFile(note({ confidence: 4 }))).toContain("confidence: 1");
    expect(buildMemoryNoteFile(note({ confidence: -2 }))).toContain("confidence: 0");
  });

  it("quotes a value that would not survive as bare YAML", () => {
    expect(buildMemoryNoteFile(note({ namespace: "a: b # c" }))).toContain('namespace: "a: b # c"');
  });

  it("round-trips a note the registry parser will read back", () => {
    const body = buildMemoryNoteFile(note());
    expect(body.startsWith("---\n")).toBe(true);
    expect(body).toContain("\n---\n\nThe three notes agree");
  });
});

describe("proposeMemoryPr", () => {
  const input = {
    token: "tok",
    fullName: "acme/ai-registry",
    kind: "summary",
    slug: "gate-is-the-control",
    note: note(),
    actor: "owner-login",
  };

  it("opens one draft PR at memory/<kind>/<slug>.md", async () => {
    const r = await proposeMemoryPr(input);
    expect(r).toMatchObject({ ok: true, number: 7, path: "memory/summary/gate-is-the-control.md" });
    expect(mockOpenPr.mock.calls[0]![0]).toMatchObject({
      owner: "acme",
      repo: "ai-registry",
      branch: "ascent/memory-gate-is-the-control",
      path: "memory/summary/gate-is-the-control.md",
    });
  });

  it("uses a branch that is STABLE across retries, so a retry updates its own PR", () => {
    expect(memoryPrBranch("x")).toBe(memoryPrBranch("x"));
    expect(memoryPrBranch("x")).not.toBe(memoryPrBranch("y"));
  });

  it("names the superseded files in the PR body, and says they are not deleted", async () => {
    await proposeMemoryPr(input);
    const body = mockOpenPr.mock.calls[0]![0].prBody as string;
    expect(body).toContain("memory/decision/old-a.md");
    expect(body).toContain("NOT deleted");
  });

  it("maps openDraftPr's 409 base-file guard to `won't overwrite`", async () => {
    // That guard is correct — it refuses to replace a real file with a generated one — and the user
    // can act on it, so it is surfaced as a state rather than as a fault.
    mockOpenPr.mockRejectedValue(new AppApiError(409, "p", "exists"));
    const r = await proposeMemoryPr(input);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(r.ok === false && r.reason).toContain("won't overwrite");
  });

  it("maps a transport failure to a 502 without leaking the error object", async () => {
    mockOpenPr.mockRejectedValue(new Error("socket hang up"));
    const r = await proposeMemoryPr(input);
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(r.ok === false && r.reason).toContain("GitHub could not be reached");
  });

  it("refuses a malformed repository name before calling GitHub", async () => {
    const r = await proposeMemoryPr({ ...input, fullName: "not a repo" });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(mockOpenPr).not.toHaveBeenCalled();
  });
});

describe("slugifyNoteName", () => {
  it("produces a filename, not a title", () => {
    expect(slugifyNoteName("The gate IS the control!")).toBe("the-gate-is-the-control");
    expect(slugifyNoteName("   ")).toBe("reflection");
    expect(slugifyNoteName("x".repeat(200))).toHaveLength(60);
  });
});
