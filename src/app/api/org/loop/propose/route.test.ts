// The curation payload — what the cockpit shows BEFORE a run, and therefore what the operator is
// agreeing to when they press Run.
//
// The lane-kind rule itself is NOT mocked here: `proposeLaneKind` runs for real against throwaway
// directories that `getRepoLocalPath` points at. The wiring is the whole risk — a route that computed
// the kind from a second, "equivalent" rule would eventually propose a foundation lane the engine
// then declines to install, and nobody would know which side was wrong.

import { afterEach, describe, expect, it, vi } from "vitest";
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

const dirs: string[] = [];

function repoDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ascent-propose-"));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, "utf8");
  }
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

type Proposal = { repo: string; items: unknown[]; projectedPoints: number; kind: string; practiceId: string | null; reason: string };

async function propose(): Promise<Proposal[]> {
  const res = await GET(new Request("https://x.test/api/org/loop/propose?org=acme&repos=acme/web"));
  const body = (await res.json()) as { proposals: Proposal[] };
  return body.proposals;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  backlog.items = [];
  delete paths["acme/web"];
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
