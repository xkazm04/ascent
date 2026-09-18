// The runner's MERGE-OUT door: `POST /api/org/local/runner/merge {org, repo}`. It writes to a branch of
// the operator's paired checkout, so it is self-hosted and OWNER gated; the repo is resolved within the
// org the caller was authorized for (unknown → 404, unpaired → 409, broken pairing → 422); and whatever
// `mergeRunnerInto` answers — including "here are the commands" — comes back as data, 200.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

const gates = { selfHosted: true, role: null as unknown, pairingOk: true };

vi.mock("@/lib/api/self-host", () => ({
  selfHostGuard: () => (gates.selfHosted ? null : new Response(JSON.stringify({ error: "Not found." }), { status: 404 })),
}));
vi.mock("@/lib/api/orgPlan", () => ({ dbGuard: () => null }));
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => gates.role) }));
vi.mock("@/lib/db/org-local", () => ({
  listLocalPairings: vi.fn(async () => [
    { fullName: "acme/api", localPath: "/work/api", watched: true },
    { fullName: "acme/web", localPath: null, watched: true },
  ]),
}));
vi.mock("@/lib/local/pairing", () => ({
  verifyLocalPath: vi.fn(async () => (gates.pairingOk ? { ok: true } : { ok: false, error: "folder moved" })),
}));
vi.mock("@/lib/local/runner-branch", () => ({
  resolveBaseBranch: vi.fn(async () => "main"),
  runnerAheadCount: vi.fn(async () => 0),
  mergeRunnerInto: vi.fn(async () => ({ ok: true, outcome: "fast-forward", mergedSha: "abc", note: "Fast-forwarded main." })),
}));
vi.mock("@/lib/local/runner-control", () => ({
  runnerBaseFor: vi.fn(async () => "trunk"),
  noteRunnerAhead: vi.fn(async () => undefined),
}));

import { POST } from "./route";
import { mergeRunnerInto } from "@/lib/local/runner-branch";
import { noteRunnerAhead } from "@/lib/local/runner-control";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/org/local/runner/merge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  gates.selfHosted = true;
  gates.role = null;
  gates.pairingOk = true;
});

describe("POST /api/org/local/runner/merge", () => {
  it("merges the runner branch into the runner's recorded base and refreshes its ahead count", async () => {
    const res = await post({ org: "acme", repo: "acme/api" });
    expect(res.status).toBe(200);
    expect(mergeRunnerInto).toHaveBeenCalledWith("/work/api", "trunk");
    expect(await res.json()).toMatchObject({ ok: true, outcome: "fast-forward", base: "trunk" });
    expect(noteRunnerAhead).toHaveBeenCalledWith("acme", "acme/api", 0);
  });

  it("returns the operator's commands as data (200), and touches no counter", async () => {
    vi.mocked(mergeRunnerInto).mockResolvedValueOnce({ ok: false, outcome: "commands", commands: ["git merge ascent/runner"], note: "diverged" });
    const res = await post({ org: "acme", repo: "acme/api" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, outcome: "commands", commands: ["git merge ascent/runner"] });
    expect(noteRunnerAhead).not.toHaveBeenCalled();
  });

  it("is self-hosted only (404) and owner-only", async () => {
    gates.selfHosted = false;
    expect((await post({ org: "acme", repo: "acme/api" })).status).toBe(404);
    gates.selfHosted = true;
    gates.role = new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });
    expect((await post({ org: "acme", repo: "acme/api" })).status).toBe(403);
    expect(mergeRunnerInto).not.toHaveBeenCalled();
  });

  it("400s a missing field and refuses the public funnel org", async () => {
    expect((await post({ org: "acme" })).status).toBe(400);
    expect((await post({ repo: "acme/api" })).status).toBe(400);
    expect((await post({ org: "public", repo: "acme/api" })).status).toBe(403);
  });

  it("404s a repo this org does not have, 409s an unpaired one, 422s a broken pairing", async () => {
    expect((await post({ org: "acme", repo: "other/repo" })).status).toBe(404);
    expect((await post({ org: "acme", repo: "acme/web" })).status).toBe(409);
    gates.pairingOk = false;
    expect((await post({ org: "acme", repo: "acme/api" })).status).toBe(422);
    expect(mergeRunnerInto).not.toHaveBeenCalled();
  });
});
