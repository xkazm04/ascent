// The one door into the indexer (ai-registry-repo#A, challenge-2026-09-23): a keyed single-flight
// with a per-trigger second-caller policy. `indexRegistry` is mocked at the module boundary and held
// open with deferreds, so every case controls exactly when a pass settles.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgRegistryRow } from "@/lib/db/org-registry";
import type { IndexRegistryResult, RegistrySource } from "./index-registry";

const indexRegistry = vi.fn<(row: OrgRegistryRow, source: RegistrySource) => Promise<IndexRegistryResult>>();
vi.mock("./index-registry", () => ({ indexRegistry: (row: OrgRegistryRow, source: RegistrySource) => indexRegistry(row, source) }));

const runGit = vi.fn();
vi.mock("@/lib/local/git", () => ({ runGit: (...a: unknown[]) => runGit(...a) }));
vi.mock("@/lib/env", () => ({ selfHosted: () => true }));

import { endIndexPass, indexPassInFlight, indexPassToken, runIndexPass } from "./index-pass";
import { refreshLocalRegistryIfStale } from "./local-registry";

const row = (over: Partial<OrgRegistryRow> = {}) => ({ id: "reg-1", fullName: "acme/ai-registry", defaultBranch: "main", localPath: null, lastIndexSha: null, ...over }) as OrgRegistryRow;
const source = (): RegistrySource => ({ readTree: vi.fn(), readBlob: vi.fn() });
const ok = (headSha: string): IndexRegistryResult => ({ kind: "ok", headSha, counts: { skills: 1, practices: 0, memory: 0, lessons: 0 }, warnings: [] });

/** A pass that settles only when the test says so. */
function hold() {
  let resolve!: (r: IndexRegistryResult) => void;
  const promise = new Promise<IndexRegistryResult>((r) => (resolve = r));
  indexRegistry.mockImplementationOnce(() => promise);
  return resolve;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  indexRegistry.mockReset();
  runGit.mockReset();
});
afterEach(async () => {
  // Drain anything a case left in flight so the module-level map is empty for the next one.
  indexRegistry.mockImplementation(async () => ok("drain"));
  for (let i = 0; i < 5 && indexPassInFlight("reg-1"); i++) await tick();
});

describe("runIndexPass — join", () => {
  it("two concurrent 'join' calls for one registry run ONE pass and share its result object", async () => {
    const settle = hold();
    const a = runIndexPass(row(), source(), "join");
    const b = runIndexPass(row(), source(), "join");
    const result = ok("sha-1");
    settle(result);
    const [ra, rb] = await Promise.all([a, b]);
    expect(indexRegistry).toHaveBeenCalledTimes(1);
    expect(ra).toBe(result);
    expect(rb).toBe(result);
    expect(indexPassInFlight("reg-1")).toBe(false);
  });

  it("different registries do not share a flight", async () => {
    indexRegistry.mockImplementation(async (r) => ok(r.id));
    const [a, b] = await Promise.all([
      runIndexPass(row({ id: "reg-1" }), source(), "join"),
      runIndexPass(row({ id: "reg-2" }), source(), "join"),
    ]);
    expect(indexRegistry).toHaveBeenCalledTimes(2);
    expect([a.headSha, b.headSha]).toEqual(["reg-1", "reg-2"]);
  });
});

describe("runIndexPass — trail", () => {
  it("three 'trail' calls during a running pass queue exactly ONE trailing pass (2 passes total, never 4)", async () => {
    const settle1 = hold();
    const first = runIndexPass(row(), source(), "join");
    const settle2 = hold();
    const lastSource = source();
    const trails = [
      runIndexPass(row(), source(), "trail"),
      runIndexPass(row(), source(), "trail"),
      runIndexPass(row(), lastSource, "trail"),
    ];
    expect(indexRegistry).toHaveBeenCalledTimes(1);
    settle1(ok("sha-1"));
    await first;
    // The trailing pass started the moment the first released — and read with the NEWEST source.
    expect(indexRegistry).toHaveBeenCalledTimes(2);
    expect(indexRegistry.mock.calls[1]![1]).toBe(lastSource);
    const trailed = ok("sha-2");
    settle2(trailed);
    const results = await Promise.all(trails);
    expect(results.every((r) => r === trailed)).toBe(true);
    expect(indexRegistry).toHaveBeenCalledTimes(2);
  });

  it("a 'trail' with nothing running starts immediately", async () => {
    const settle = hold();
    const p = runIndexPass(row(), source(), "trail");
    expect(indexRegistry).toHaveBeenCalledTimes(1);
    expect(indexPassInFlight("reg-1")).toBe(true);
    settle(ok("sha-now"));
    expect((await p).headSha).toBe("sha-now");
  });
});

describe("runIndexPass — token-scoped release", () => {
  it("a late end() from pass #1 cannot clear pass #2's entry: a third 'join' still joins #2", async () => {
    const settle1 = hold();
    const p1 = runIndexPass(row(), source(), "join");
    const token1 = indexPassToken("reg-1");
    expect(token1).not.toBeNull();
    settle1(ok("sha-1"));
    await p1;

    const settle2 = hold();
    const p2 = runIndexPass(row(), source(), "join");
    // The defect local-registry.ts:76 had: a caller deleting an entry it never (or no longer) owned.
    expect(endIndexPass("reg-1", token1!)).toBe(false);
    expect(indexPassInFlight("reg-1")).toBe(true);
    const p3 = runIndexPass(row(), source(), "join");
    expect(indexRegistry).toHaveBeenCalledTimes(2);
    const result2 = ok("sha-2");
    settle2(result2);
    expect(await p2).toBe(result2);
    expect(await p3).toBe(result2);
  });

  it("guard: a failed pass resolves to its error result and releases the slot for the next pass", async () => {
    indexRegistry.mockResolvedValueOnce({ kind: "error", message: "rate limited" });
    expect(await runIndexPass(row(), source(), "join")).toEqual({ kind: "error", message: "rate limited" });
    expect(indexPassInFlight("reg-1")).toBe(false);
    indexRegistry.mockRejectedValueOnce(new Error("boom"));
    expect(await runIndexPass(row(), source(), "join")).toEqual({ kind: "error", message: "boom" });
    expect(indexPassInFlight("reg-1")).toBe(false);
  });
});

describe("refreshLocalRegistryIfStale over the shared door", () => {
  const local = (over: Partial<OrgRegistryRow> = {}) => row({ id: "reg-local", localPath: "/srv/ai-registry", lastIndexSha: "head-1", ...over });

  it("guard: does nothing when the checkout HEAD equals lastIndexSha", async () => {
    runGit.mockResolvedValue({ ok: true, stdout: "head-1\n" });
    refreshLocalRegistryIfStale(local(), 1_000_000);
    await tick();
    expect(runGit).toHaveBeenCalledTimes(1);
    expect(indexRegistry).not.toHaveBeenCalled();
  });

  it("guard: probes at most once per 30s window, and a moved HEAD indexes through the door", async () => {
    runGit.mockResolvedValue({ ok: true, stdout: "head-2\n" });
    indexRegistry.mockResolvedValue(ok("head-2"));
    const r = local({ id: "reg-window" });
    refreshLocalRegistryIfStale(r, 5_000_000);
    refreshLocalRegistryIfStale(r, 5_010_000);
    await tick();
    expect(runGit).toHaveBeenCalledTimes(1);
    expect(indexRegistry).toHaveBeenCalledTimes(1);
    refreshLocalRegistryIfStale(r, 5_031_000);
    await tick();
    expect(runGit).toHaveBeenCalledTimes(2);
  });

  it("skips while a pass for that registry is already in flight", async () => {
    const settle = hold();
    const r = local({ id: "reg-busy" });
    const running = runIndexPass(r, source(), "join");
    refreshLocalRegistryIfStale(r, 9_000_000);
    await tick();
    expect(runGit).not.toHaveBeenCalled();
    settle(ok("x"));
    await running;
  });
});
