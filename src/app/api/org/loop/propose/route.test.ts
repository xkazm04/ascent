// The curation payload — what the cockpit shows BEFORE a run, and therefore what the operator is
// agreeing to when they press Run.
//
// The lane-kind rule itself is NOT mocked here: `proposeLaneKind` runs for real against throwaway
// directories that `getRepoLocalPath` points at. The wiring is the whole risk — a route that computed
// the kind from a second, "equivalent" rule would eventually propose a foundation lane the engine
// then declines to install, and nobody would know which side was wrong.

import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public" }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null) }));

const paths: Record<string, string | null> = {};
vi.mock("@/lib/db", () => ({ getRepoLocalPath: vi.fn(async (_org: string, repo: string) => paths[repo] ?? null) }));

const backlog = {
  items: [] as { id: string; repo: string; title: string; dimId: string; dimLabel: string; impact: string; effort: string; rationale: string; explore: string[]; projectedPoints: number }[],
};
vi.mock("@/lib/local/loop-lane", () => ({ openBatch: vi.fn(async () => backlog.items) }));

import { GET } from "./route";
import { openBatch } from "@/lib/local/loop-lane";

const dirs: string[] = [];

function repoDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ascent-propose-"));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, "utf8");
  }
  // A REAL working copy: the route verifies every stored pairing with `verifyLocalPath` (the engine's
  // own check) before it reads the folder, so a plain directory would read as a broken pairing.
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.test", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir });
  return dir;
}

const item = (id: string, dimId: string) => ({
  id,
  repo: "acme/web",
  title: `gap ${id}`,
  dimId,
  dimLabel: dimId,
  impact: "high",
  effort: "low",
  rationale: "",
  explore: [],
  projectedPoints: 5,
});

type Proposal = { repo: string; items: unknown[]; projectedPoints: number; kind: string; practiceId: string | null; reason: string; pairing?: unknown; brief?: unknown };

async function propose(): Promise<Proposal[]> {
  const res = await GET(new Request("https://x.test/api/org/loop/propose?org=acme&repos=acme/web"));
  const body = (await res.json()) as { proposals: Proposal[] };
  return body.proposals;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  backlog.items = [];
  delete paths["acme/web"];
  vi.mocked(openBatch).mockClear();
});

describe("GET /api/org/loop/propose — the lane kind travels with the batch", () => {
  it("leads with a foundation lane when the repo has no .ai/ standard, and offers nothing to curate", async () => {
    paths["acme/web"] = repoDir({ "README.md": "hi" });
    backlog.items = [item("rec-1", "D1")];

    const [p] = await propose();
    expect(p!.kind).toBe("foundation");
    expect(p!.items).toEqual([]);
    expect(p!.projectedPoints).toBe(0);
    expect(p!.reason).toMatch(/\.ai\/ foundation/);
  });

  it("proposes a practice lane for a gap the library has a starter for", async () => {
    paths["acme/web"] = repoDir({ ".ai/manifest.yaml": "version: 1" });
    backlog.items = [item("rec-1", "D1")]; // D1 → agent-guidance → AGENTS.md, absent here

    const [p] = await propose();
    expect(p!.kind).toBe("practice");
    expect(p!.practiceId).toBe("agent-guidance");
    // The rows stay curatable: a practice lane answers one of them, and the operator may prune it.
    expect(p!.items).toHaveLength(1);
  });

  it("keeps the agent lane, and the batch, for everything else", async () => {
    paths["acme/web"] = repoDir({ ".ai/manifest.yaml": "version: 1", "AGENTS.md": "# here" });
    backlog.items = [item("rec-1", "D1")];

    const [p] = await propose();
    expect(p!.kind).toBe("backlog");
    expect(p!.practiceId).toBeNull();
    expect(p!.items).toHaveLength(1);
    expect(p!.projectedPoints).toBe(5);
  });

  // PRIYA-L1-703: this route no longer carries `selfHostGuard`. A cloud owner can ARM a
  // `remote-agent` run, and a curation step that 404s on the deployment whose start route says yes
  // is the cockpit denying a capability the deployment ships. There is no self-host mock in this
  // file precisely so the route's own behaviour is what is measured here.
  it("answers on a deployment with no checkout at all — a backlog proposal, never a 404", async () => {
    backlog.items = [item("rec-1", "D1")];
    const res = await GET(new Request("https://x.test/api/org/loop/propose?org=acme&repos=acme/web"));
    expect(res.status).toBe(200);
    const [p] = ((await res.json()) as { proposals: Proposal[] }).proposals;
    // `proposeLaneKind(null, …)` returns BACKLOG by construction: with no working copy the file
    // tests cannot run, and claiming `foundation` would be a claim about a directory nobody read.
    expect(p!.kind).toBe("backlog");
    expect(p!.items).toHaveLength(1);
  });
});

// THE BATCH-SIZE DIAL (2026-09-18). The route used to call `openBatch(org, repo)` — the default five —
// while the engine sizes a lane by `batchSizeOf(run.batchSize)`, so an operator who armed a batch of
// twelve could only ever see, and curate, five. It now takes the dial and validates it with the SAME
// normalizer `POST /api/org/loop` uses, under the same convention: absent = default, sent-but-invalid
// = a 400 naming the band, never a silent clamp.
describe("GET /api/org/loop/propose — the batch-size dial", () => {
  const get = (q: string) => GET(new Request(`https://x.test/api/org/loop/propose?org=acme&repos=acme/web${q}`));
  const limits = () => vi.mocked(openBatch).mock.calls.map((c) => c[2]);

  it("sizes the batch by the dial the cockpit sends", async () => {
    const res = await get("&batchSize=12");
    expect(res.status).toBe(200);
    expect(limits()).toEqual([12]);
  });

  it("keeps the engine's default when the dial is absent — byte-identical to a pre-dial request", async () => {
    await get("");
    expect(limits()).toEqual([5]);
  });

  it.each(["0", "13", "5.5", "1e1", "", "abc", "-3"])("answers batchSize=%j with a 400 naming the band, and reads nothing", async (v) => {
    const res = await get(`&batchSize=${encodeURIComponent(v)}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/batchSize must be a whole number 1–12/);
    expect(openBatch).not.toHaveBeenCalled();
  });
});

// A MOVED CHECKOUT (challenge-2026-09-23b, local-autopilot-loop-engine#B). The stored `localPath` is a
// claim made at pairing time; the filesystem is the evidence. The route used to hand the claim straight
// to `proposeLaneKind`, whose `exists()` reads every stat failure as "absent", so a folder that is
// simply GONE proposed a confident "install the .ai/ foundation" lane. It now asks `verifyLocalPath`
// (the engine's own check) first, and a broken pairing is said, not guessed around.
describe("GET /api/org/loop/propose — a broken pairing is reported, never read as 'no foundation'", () => {
  const gone = () => join(tmpdir(), `ascent-propose-gone-${process.pid}-${Date.now()}`);

  it("a stored path that no longer exists → pairing {ok:false} with the verifier's sentence, no items, a backlog kind", async () => {
    paths["acme/web"] = gone();
    backlog.items = [item("rec-1", "D1")];

    const [p] = await propose();
    expect(p!.pairing).toEqual({ ok: false, error: "Folder does not exist on the server's filesystem." });
    expect(p!.items).toEqual([]);
    expect(p!.projectedPoints).toBe(0);
    expect(p!.kind).toBe("backlog");
    expect(p!.reason).not.toMatch(/foundation/);
    // Nothing downstream of a broken pairing is read: no batch, no brief.
    expect(openBatch).not.toHaveBeenCalled();
    expect(p!.brief).toBeNull();
  });

  it("guard: a healthy paired repo is unchanged apart from pairing {ok:true}", async () => {
    paths["acme/web"] = repoDir({ ".ai/manifest.yaml": "version: 1", "AGENTS.md": "# here" });
    backlog.items = [item("rec-1", "D1")];

    const [p] = await propose();
    expect(p!.pairing).toEqual({ ok: true });
    expect(p!.kind).toBe("backlog");
    expect(p!.items).toHaveLength(1);
    expect(p!.projectedPoints).toBe(5);
    expect(p!.reason).toBe("Works this repo's open follow-ups with a local agent.");
  });

  it("guard: a repo with no stored path carries no pairing verdict (nothing was claimed, so nothing is checked)", async () => {
    backlog.items = [item("rec-1", "D1")];
    const [p] = await propose();
    expect(p!.pairing ?? null).toBeNull();
    expect(p!.items).toHaveLength(1);
  });

  it("guard: the response never carries the stored localPath, healthy or broken (the route is member-readable)", async () => {
    for (const stored of [gone(), repoDir({ ".ai/manifest.yaml": "version: 1" })]) {
      paths["acme/web"] = stored;
      const res = await GET(new Request("https://x.test/api/org/loop/propose?org=acme&repos=acme/web"));
      const text = await res.text();
      expect(text).not.toContain(JSON.stringify(stored).slice(1, -1));
      expect(text).not.toContain(stored);
    }
  });
});
