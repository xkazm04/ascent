// playbooks-1: applyPlaybookToRepo in REVISION mode. After a title edit the committed path must stay
// the one the ledger recorded (the file that landed), never a freshly slugged second file; the PR may
// replace that file only when its base bytes are the digest Ascent landed; and the ledger row records
// the version it carries while keeping its `adopted` state (the baseline moves only when it lands).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/github/source", () => ({
  fetchRepoContext: vi.fn(async (p: { owner: string; repo: string }) => ({ fullName: `${p.owner}/${p.repo}` })),
}));
vi.mock("@/lib/github/write", () => ({
  openDraftPr: vi.fn(async () => ({ url: "https://github.com/acme/api/pull/4", number: 4, branch: "b", reused: false })),
}));
vi.mock("@/lib/db", () => ({
  getOrgId: vi.fn(async () => "org1"),
  recordOrgAudit: vi.fn(async () => true),
}));
vi.mock("@/lib/db/practice-adoption", () => ({ recordProposedAdoption: vi.fn(async () => undefined) }));

import { applyPlaybookToRepo } from "./playbook-apply";
import { openDraftPr } from "@/lib/github/write";
import { recordProposedAdoption } from "@/lib/db/practice-adoption";
import { contentDigest } from "@/lib/registry/parse";
import { playbookStarterFile } from "@/lib/org/playbook-brief";
import type { PlaybookRow } from "@/lib/db";

const playbook: PlaybookRow = {
  id: "pb1",
  title: "Renamed CI standard",
  dimId: "D2",
  summary: "s",
  steps: ["lint"],
  createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  version: 3,
  updatedAt: "2026-02-01T00:00:00.000Z",
};
const LANDED_PATH = "docs/playbooks/pb1-old-ci-standard.md";

beforeEach(() => vi.clearAllMocks());

describe("applyPlaybookToRepo revision mode", () => {
  it("commits to the ledger's landed path with the landed digest as the replace guard", async () => {
    await applyPlaybookToRepo({
      token: "t",
      org: "acme",
      playbook,
      parsed: { owner: "acme", repo: "api" },
      actorLogin: "alice",
      revision: { artifactPath: LANDED_PATH, baseDigest: "sha256-n1:landed" },
    });
    const arg = vi.mocked(openDraftPr).mock.calls[0]![0];
    expect(arg.path).toBe(LANDED_PATH);
    expect(arg.path).not.toContain("renamed");
    expect(arg.replaceIfBaseDigest).toBe("sha256-n1:landed");
    expect(arg.branch).toContain("v3");
    expect(arg.prBody).toContain(LANDED_PATH);
    expect(arg.prBody).not.toContain("—");
  });

  it("records the v3 digest and version on the SAME ledger row, never a second path", async () => {
    await applyPlaybookToRepo({
      token: "t",
      org: "acme",
      playbook,
      parsed: { owner: "acme", repo: "api" },
      actorLogin: null,
      revision: { artifactPath: LANDED_PATH, baseDigest: "sha256-n1:landed" },
    });
    const row = vi.mocked(recordProposedAdoption).mock.calls[0]![0];
    expect(row).toMatchObject({
      practiceId: "playbook:pb1",
      source: "playbook",
      artifactPath: LANDED_PATH,
      patternVersion: 3,
      proposedHash: contentDigest(playbookStarterFile(playbook, "Testing")),
    });
  });

  it("guard: the first apply is unchanged (title-slug path, no replace option, patternVersion null)", async () => {
    await applyPlaybookToRepo({ token: "t", org: "acme", playbook, parsed: { owner: "acme", repo: "api" }, actorLogin: null });
    const arg = vi.mocked(openDraftPr).mock.calls[0]![0];
    expect(arg.path).toBe("docs/playbooks/pb1-renamed-ci-standard.md");
    expect(arg).not.toHaveProperty("replaceIfBaseDigest");
    expect(vi.mocked(recordProposedAdoption).mock.calls[0]![0].patternVersion).toBeNull();
  });
});
