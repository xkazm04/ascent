// repositories-segments 2026-07-16 #3: the CSV export must honor the SAME posture/stack filters the
// Repositories tab shows (previously it always exported the full fleet while the header said
// "12 of 80 repos in At risk"), and must carry each repo's segment memberships.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getOrgRollup: vi.fn(),
  getRepoSegmentMap: vi.fn(async () => ({ "acme/web": [{ id: "s1", name: "platform", color: "#3b9eff" }, { id: "s2", name: "legacy", color: "#f97316" }] })),
}));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn(async () => null) }));
vi.mock("@/lib/org/scope", () => ({
  resolveStackScope: vi.fn(async (_org: string, sp: { stack?: string }) => ({
    techGroups: [],
    activeStack: sp.stack === "frontend" ? { key: "frontend" } : null,
    techGroupId: sp.stack === "frontend" ? "tg1" : null,
  })),
}));

import { GET } from "./route";
import { getOrgRollup } from "@/lib/db";

function repo(fullName: string, posture: string) {
  const name = fullName.split("/")[1]!;
  return {
    fullName,
    name,
    isPrivate: false,
    watched: true,
    primaryLanguage: "ts",
    techStack: null,
    scanSchedule: "off",
    latest: { scannedAt: "2026-07-16T00:00:00Z", level: "L3", overall: 70, adoption: 60, rigor: 80, posture },
  };
}

beforeEach(() => {
  vi.mocked(getOrgRollup).mockResolvedValue({
    repos: [repo("acme/web", "ungoverned"), repo("acme/api", "healthy")],
  } as never);
});

const get = (qs: string) => GET(new Request(`http://x/api/org/repositories?${qs}`));

describe("GET /api/org/repositories filters (#3)", () => {
  it("csv with ?posture= exports only the repos the filtered tab shows", async () => {
    const res = await get("org=acme&format=csv&posture=ungoverned");
    const csv = await res.text();
    expect(csv).toContain("acme/web");
    expect(csv).not.toContain("acme/api");
  });

  it("a bogus posture falls back to the whole fleet (the page's contract)", async () => {
    const csv = await (await get("org=acme&format=csv&posture=nonsense")).text();
    expect(csv).toContain("acme/web");
    expect(csv).toContain("acme/api");
  });

  it("threads ?stack= into the rollup scope", async () => {
    await get("org=acme&format=csv&stack=frontend");
    expect(vi.mocked(getOrgRollup)).toHaveBeenCalledWith("acme", undefined, null, "tg1");
  });

  it("carries segment memberships as a ;-joined column", async () => {
    const csv = await (await get("org=acme&format=csv")).text();
    const header = csv.split("\n")[0]!;
    expect(header.split(",")).toContain("segments");
    const webRow = csv.split("\n").find((l) => l.startsWith("acme/web"))!;
    expect(webRow).toContain("platform;legacy");
  });
});
