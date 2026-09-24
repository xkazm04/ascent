// Pins backlog develop-2026-09-17 row 35: repos NEWLY GRANTED on a GitHub App installation are
// auto-watched, but only (a) from the live listing the caller hands in (never the payload), (b) for an
// org that already runs a watchlist, (c) at most GRANT_AUTO_WATCH_CAP per event with the overflow
// logged + audited, and (d) never for a repo the org has a row for already, because a stored
// `watched: false` may be a person's explicit unwatch and the tree records no author for that flag.

import { describe, it, expect, vi, beforeEach } from "vitest";

const organization = { findMany: vi.fn() };
const repository = { count: vi.fn(), findMany: vi.fn() };
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({ organization, repository }),
}));
vi.mock("@/lib/db/org-watch", () => ({ setRepoWatch: vi.fn(async () => {}), setRepoSchedule: vi.fn(async () => {}) }));
vi.mock("@/lib/db/scans-audit", () => ({ recordOrgAudit: vi.fn(async () => true) }));

import {
  AUTO_WATCH_ACTION,
  GRANT_AUTO_WATCH_CAP,
  applyGrantedAutoWatch,
  planGrantedAutoWatch,
  selectNewlyGranted,
  type GrantedRepo,
} from "./install-grants";
import { setRepoSchedule, setRepoWatch } from "@/lib/db/org-watch";
import { recordOrgAudit } from "@/lib/db/scans-audit";

const repo = (fullName: string): GrantedRepo => {
  const [owner, name] = fullName.split("/");
  return { fullName, owner: owner!, name: name!, url: `https://github.com/${fullName}`, private: true };
};
const names = (n: number, prefix = "acme/new") => Array.from({ length: n }, (_, i) => `${prefix}-${String(i).padStart(2, "0")}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  organization.findMany.mockResolvedValue([{ id: "org_1", slug: "acme" }]);
  repository.count.mockResolvedValue(3);
  repository.findMany.mockResolvedValue([{ fullName: "acme/api" }, { fullName: "acme/web" }]);
});

describe("selectNewlyGranted", () => {
  it("picks only names the org has no row for, case-insensitively and deduplicated", () => {
    const known = new Set(["acme/api"]);
    const out = selectNewlyGranted([repo("ACME/Api"), repo("acme/new"), repo("acme/NEW")], known);
    expect(out.watch.map((r) => r.fullName)).toEqual(["acme/new"]);
    expect(out.overflow).toEqual([]);
  });

  it("caps at GRANT_AUTO_WATCH_CAP in a stable name order; the rest is overflow, not dropped", () => {
    const live = names(25).reverse().map(repo);
    const out = selectNewlyGranted(live, new Set());
    expect(GRANT_AUTO_WATCH_CAP).toBe(20);
    expect(out.watch.map((r) => r.fullName)).toEqual(names(20));
    expect(out.overflow).toEqual(names(25).slice(20));
  });
});

describe("planGrantedAutoWatch", () => {
  it("plans a single newly granted repo for an org with a watchlist", async () => {
    const plans = await planGrantedAutoWatch(42, [repo("acme/api"), repo("acme/web"), repo("acme/billing")]);
    expect(organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { githubInstallId: "42", kind: { not: "personal" } } }),
    );
    expect(plans).toEqual([{ orgSlug: "acme", watch: [repo("acme/billing")], overflow: [] }]);
  });

  it("does not auto-watch for an org whose watchlist is empty (it never opted into a fleet)", async () => {
    repository.count.mockResolvedValue(0);
    expect(await planGrantedAutoWatch(42, [repo("acme/billing")])).toEqual([]);
    expect(repository.findMany).not.toHaveBeenCalled();
  });

  it("guard: a granted repo with ANY existing row (e.g. a person's watched:false) is never re-watched", async () => {
    // The tree records no author for `watched: false`: a user unwatch (setRepoWatch false) and a scanned
    // but unwatched row are indistinguishable, so row presence is the only safe signal. The read must
    // therefore span every row of the org, not only the watched ones.
    repository.findMany.mockResolvedValue([{ fullName: "acme/api" }, { fullName: "acme/unwatched-by-a-person" }]);
    const plans = await planGrantedAutoWatch(42, [repo("acme/unwatched-by-a-person")]);
    expect(plans).toEqual([]);
    expect(repository.findMany.mock.calls[0]![0].where).toEqual({ orgId: "org_1" });
  });

  it("guard: no plan without an org bound to the installation, or with an empty live set", async () => {
    organization.findMany.mockResolvedValueOnce([]);
    expect(await planGrantedAutoWatch(42, [repo("acme/billing")])).toEqual([]);
    expect(await planGrantedAutoWatch(42, [])).toEqual([]);
  });
});

describe("applyGrantedAutoWatch", () => {
  it("watches through the import path (watch + the import's weekly cadence) and audits it", async () => {
    const out = await applyGrantedAutoWatch(42, [{ orgSlug: "acme", watch: [repo("acme/billing")], overflow: [] }]);
    expect(setRepoWatch).toHaveBeenCalledWith(
      "acme",
      { owner: "acme", name: "billing", fullName: "acme/billing", url: "https://github.com/acme/billing", isPrivate: true },
      true,
    );
    expect(setRepoSchedule).toHaveBeenCalledWith("acme", "acme/billing", "weekly");
    expect(out).toEqual([{ orgSlug: "acme", watched: ["acme/billing"], failed: [], overflow: [] }]);
    expect(recordOrgAudit).toHaveBeenCalledWith(
      AUTO_WATCH_ACTION,
      "acme",
      expect.objectContaining({ installationId: 42, watched: ["acme/billing"], overflowCount: 0 }),
    );
  });

  it("leaves the overflow unwatched, but logs and audits it rather than dropping it silently", async () => {
    const plan = { orgSlug: "acme", watch: names(20).map(repo), overflow: names(25).slice(20) };
    const [res] = await applyGrantedAutoWatch(42, [plan]);
    expect(setRepoWatch).toHaveBeenCalledTimes(20);
    expect(res!.overflow).toEqual(names(25).slice(20));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("5 more newly granted repo(s) left unwatched"));
    expect(recordOrgAudit).toHaveBeenCalledWith(
      AUTO_WATCH_ACTION,
      "acme",
      expect.objectContaining({ overflowCount: 5, overflow: names(25).slice(20), cap: 20 }),
    );
  });

  it("one failing watch write does not stop the rest; it is reported as failed", async () => {
    vi.mocked(setRepoWatch).mockRejectedValueOnce(new Error("P2002"));
    const [res] = await applyGrantedAutoWatch(42, [{ orgSlug: "acme", watch: [repo("acme/a"), repo("acme/b")], overflow: [] }]);
    expect(res).toEqual({ orgSlug: "acme", watched: ["acme/b"], failed: ["acme/a"], overflow: [] });
  });
});
