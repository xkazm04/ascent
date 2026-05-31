import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// Mock the Prisma client layer so we can drive upsert/update/findMany without a database.
const organization = {
  upsert: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
};
const repository = {
  updateMany: vi.fn(),
};

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({ organization, repository }),
}));

import { upsertInstallation, removeInstallation } from "./installations";

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
