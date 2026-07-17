import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// Mock the Prisma client layer so we can drive upsert/update/findMany without a database.
const organization = {
  upsert: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
  // Rename/transfer reconciliation (07-16 #2): findFirst looks up the install id under another slug;
  // findUnique checks whether the current slug already exists. Both default to undefined (= no row).
  findFirst: vi.fn(),
  findUnique: vi.fn(),
};
const repository = {
  updateMany: vi.fn(),
};

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({ organization, repository }),
}));

import { upsertInstallation, removeInstallation, suspendInstallation, resumeInstallation } from "./installations";

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["slug"] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upsertInstallation", () => {
  it("writes the installation via upsert on the happy path", async () => {
    organization.upsert.mockResolvedValueOnce({});
    await upsertInstallation({ login: "Acme", installationId: 42 });

    expect(organization.upsert).toHaveBeenCalledTimes(1);
    const arg = organization.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ slug: "acme" }); // lowercased slug
    expect(arg.update).toEqual({ githubInstallId: "42", name: "Acme" });
    expect(organization.update).not.toHaveBeenCalled();
  });

  // Plan policy (github-app-installation-webhooks 07-16 #1): installing the App must not mint an
  // entitlement. Create uses the platform default plan; update never carries `plan` at all, so an
  // installation event can neither upgrade nor downgrade an existing org.
  it("creates new orgs on the DEFAULT plan (never the legacy 'private' grant) and never touches plan on update", async () => {
    organization.upsert.mockResolvedValueOnce({});
    await upsertInstallation({ login: "Acme", installationId: 42 });

    const arg = organization.upsert.mock.calls[0][0];
    expect(arg.create.plan).toBe("free");
    expect(arg.update).not.toHaveProperty("plan");
  });

  it("retries as an update when a concurrent insert races to P2002", async () => {
    organization.upsert.mockRejectedValueOnce(p2002());
    organization.update.mockResolvedValueOnce({});

    await expect(
      upsertInstallation({ login: "Acme", installationId: 42 }),
    ).resolves.toBeUndefined();

    expect(organization.update).toHaveBeenCalledTimes(1);
    expect(organization.update.mock.calls[0][0]).toEqual({
      where: { slug: "acme" },
      data: { githubInstallId: "42", name: "Acme" },
    });
  });

  // ── GitHub org rename / installation transfer (github-app-installation-webhooks 07-16 #2) ──────
  // installation.id is the stable key; the login (== slug) is mutable. A rename used to FORK the
  // tenant: a fresh empty row under the new slug while the stale slug kept the watched repos and
  // silently stopped matching webhooks.

  it("RENAME: migrates the existing org row to the new slug (same install id) instead of forking a new org", async () => {
    organization.findFirst.mockResolvedValueOnce({ id: "org-1", slug: "acme" });
    organization.findUnique.mockResolvedValueOnce(null); // new slug not taken → clean rename
    organization.update.mockResolvedValueOnce({});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await upsertInstallation({ login: "Acme-Inc", installationId: 42 });

    // The install-id row is renamed in place — repos/watch flags/schedules ride along via orgId…
    expect(organization.update).toHaveBeenCalledTimes(1);
    expect(organization.update.mock.calls[0][0]).toEqual({
      where: { id: "org-1" },
      data: { slug: "acme-inc", name: "Acme-Inc", githubInstallId: "42" },
    });
    // …and NO second org row is minted for the new slug.
    expect(organization.upsert).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('migrated org slug "acme" -> "acme-inc"'));
    warn.mockRestore();
  });

  it("TRANSFER onto an already-existing slug: moves the installation there and detaches the stale row (one org per install id)", async () => {
    organization.findFirst.mockResolvedValueOnce({ id: "org-1", slug: "acme" });
    organization.findUnique.mockResolvedValueOnce({ id: "org-2" }); // the new login already has an org row
    organization.update.mockResolvedValueOnce({});
    organization.upsert.mockResolvedValueOnce({});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await upsertInstallation({ login: "Acme-Inc", installationId: 42 });

    // The stale row is detached FIRST, so the install id never points at two orgs…
    expect(organization.update).toHaveBeenCalledTimes(1);
    expect(organization.update.mock.calls[0][0]).toEqual({
      where: { id: "org-1" },
      data: { githubInstallId: null },
    });
    // …then the installation lands on the row matching the CURRENT login.
    expect(organization.upsert).toHaveBeenCalledTimes(1);
    expect(organization.upsert.mock.calls[0][0].where).toEqual({ slug: "acme-inc" });
    expect(organization.upsert.mock.calls[0][0].update).toEqual({ githubInstallId: "42", name: "Acme-Inc" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("were not migrated"));
    warn.mockRestore();
  });

  it("rethrows non-P2002 errors instead of swallowing them", async () => {
    organization.upsert.mockRejectedValueOnce(new Error("connection reset"));
    await expect(
      upsertInstallation({ login: "Acme", installationId: 42 }),
    ).rejects.toThrow("connection reset");
    expect(organization.update).not.toHaveBeenCalled();
  });
});

describe("removeInstallation", () => {
  it("quiesces watched/scheduled repos before detaching the install id", async () => {
    organization.findMany.mockResolvedValueOnce([{ id: "org-1" }, { id: "org-2" }]);
    repository.updateMany.mockResolvedValueOnce({ count: 3 });
    organization.updateMany.mockResolvedValueOnce({ count: 2 });

    await removeInstallation(99);

    // Repos for the affected orgs are unwatched and their schedules paused.
    expect(repository.updateMany).toHaveBeenCalledTimes(1);
    expect(repository.updateMany.mock.calls[0][0]).toEqual({
      where: { orgId: { in: ["org-1", "org-2"] } },
      data: { watched: false, scanSchedule: "off", nextScanAt: null },
    });
    // The install id is detached.
    expect(organization.updateMany).toHaveBeenCalledTimes(1);
    expect(organization.updateMany.mock.calls[0][0]).toEqual({
      where: { githubInstallId: "99" },
      data: { githubInstallId: null },
    });
  });

  it("skips the repo update when no org matches the installation", async () => {
    organization.findMany.mockResolvedValueOnce([]);
    organization.updateMany.mockResolvedValueOnce({ count: 0 });

    await removeInstallation(99);

    expect(repository.updateMany).not.toHaveBeenCalled();
    expect(organization.updateMany).toHaveBeenCalledTimes(1);
  });
});

// github-app-installation-webhooks (2026-07-16) #5: suspend used to pause EVERY `scanSchedule != off`
// repo regardless of `watched`, while resume re-armed only `watched && scanSchedule != off` — so a repo
// in the (invariant-breaking) state `watched:false, scanSchedule:"weekly"` was paused by a suspend and
// never re-armed by the matching unsuspend: a routine billing-lapse cycle became permanent schedule
// loss. The two predicates must be IDENTICAL so suspend→resume round-trips every row it touched.
describe("suspendInstallation / resumeInstallation — symmetric predicates (round-trip safety)", () => {
  it("suspend and resume target the SAME where-predicate (watched: true, scanSchedule != off)", async () => {
    organization.findMany.mockResolvedValue([{ id: "org-1" }]);
    repository.updateMany.mockResolvedValue({ count: 1 });

    await suspendInstallation(99);
    await resumeInstallation(99);

    expect(repository.updateMany).toHaveBeenCalledTimes(2);
    const suspendWhere = repository.updateMany.mock.calls[0][0].where;
    const resumeWhere = repository.updateMany.mock.calls[1][0].where;
    // The load-bearing assertion: identical predicates → resume re-arms exactly what suspend paused.
    expect(suspendWhere).toEqual(resumeWhere);
    expect(suspendWhere).toEqual({
      orgId: { in: ["org-1"] },
      watched: true,
      scanSchedule: { not: "off" },
    });
    // And the actions are true inverses of each other on nextScanAt.
    expect(repository.updateMany.mock.calls[0][0].data).toEqual({ nextScanAt: null });
    expect(repository.updateMany.mock.calls[1][0].data).toEqual({ nextScanAt: expect.any(Date) });
  });

  it("both are no-ops when no org matches the installation", async () => {
    organization.findMany.mockResolvedValue([]);
    await suspendInstallation(99);
    await resumeInstallation(99);
    expect(repository.updateMany).not.toHaveBeenCalled();
  });
});
