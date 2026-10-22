// The cohort door behind the org care aggregate (C4, challenge 2026-10-22d developer-0). A fake Prisma
// that applies the where clause it is handed honestly, so these pin WHAT the reader asks for (consent
// and org membership in the query itself) as well as what it hands back (payloads, never a login).

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { login: string; payloadJson: string; orgAggregate: boolean };
const { prisma, state } = vi.hoisted(() => {
  const state = { members: {} as Record<string, string[]>, shares: [] as Row[] };
  const prisma = {
    membership: {
      findMany: vi.fn(async (args: { where: { org: { slug: string } } }) =>
        (state.members[args.where.org.slug] ?? []).map((githubLogin) => ({ user: { githubLogin } }))),
    },
    mentorShare: {
      findMany: vi.fn(async (args: { where: { orgAggregate?: boolean; login?: { in: string[] } } }) =>
        state.shares
          .filter((s) => args.where.orgAggregate === undefined || s.orgAggregate === args.where.orgAggregate)
          .filter((s) => !args.where.login || args.where.login.in.includes(s.login))
          .map((s) => ({ payloadJson: s.payloadJson }))),
      upsert: vi.fn(async () => ({})),
    },
  };
  return { prisma, state };
});

vi.mock("@/lib/db/client", () => ({ getPrisma: () => prisma, isDbConfigured: () => true }));

import { getOrgCareCohort } from "./mentor-share-cohort";
import { saveMentorShare } from "./mentor-share";
import { PUBLIC_ORG } from "@/lib/org-constants";

const share = (planModePct: number, consent?: boolean) =>
  JSON.stringify({
    contract: 1,
    ...(consent === undefined ? {} : { consent: { orgAggregate: consent } }),
    shape: { contract: 1, windowDays: 30, launcher: "interactive-only", excludedProgrammatic: 0, fields: { planModePct } },
  });

beforeEach(() => {
  vi.clearAllMocks();
  state.members = { acme: ["Ada", "bob", "cy", null as unknown as string] };
  state.shares = [
    { login: "ada", payloadJson: share(10, true), orgAggregate: true },
    { login: "bob", payloadJson: share(20, false), orgAggregate: false },
    { login: "cy", payloadJson: share(30), orgAggregate: false },
    { login: "outsider", payloadJson: share(99, true), orgAggregate: true },
  ];
});

describe("getOrgCareCohort", () => {
  it("asks for consenting shares of the org's members only, in the query itself", async () => {
    const cohort = await getOrgCareCohort("acme");
    expect(prisma.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { org: { slug: "acme" } } }));
    const where = prisma.mentorShare.findMany.mock.calls[0]![0].where;
    expect(where.orgAggregate).toBe(true);
    expect([...where.login!.in].sort()).toEqual(["ada", "bob", "cy"]);
    expect(where.login!.in).not.toContain("outsider");
    expect(cohort.shares).toHaveLength(1);
    expect(cohort.shares[0]!.shape?.fields).toEqual({ planModePct: 10 });
  });

  it("a member whose share does not consent contributes nothing, and no login leaves the reader", async () => {
    const cohort = await getOrgCareCohort("acme");
    const out = JSON.stringify(cohort);
    for (const login of ["ada", "Ada", "bob", "cy", "outsider"]) expect(out).not.toContain(`"${login}"`);
    expect(out).not.toContain("20");
    expect(out).not.toContain("99");
  });

  it("drops a row whose payload no longer consents even if the column says it does", async () => {
    state.shares[0]!.payloadJson = share(10, false);
    expect((await getOrgCareCohort("acme")).shares).toEqual([]);
  });

  it("refuses the public org and an org with no members without reading a share", async () => {
    expect(await getOrgCareCohort(PUBLIC_ORG)).toEqual({ shares: [] });
    expect(await getOrgCareCohort("ghost")).toEqual({ shares: [] });
    expect(prisma.mentorShare.findMany).not.toHaveBeenCalled();
  });
});

describe("saveMentorShare writes the consent column from the validated share", () => {
  it("no consent section saves orgAggregate=false; an explicit yes saves true", async () => {
    await saveMentorShare("Ada", { contract: 1 });
    await saveMentorShare("Ada", { contract: 1, consent: { orgAggregate: true } });
    const [first, second] = prisma.mentorShare.upsert.mock.calls as unknown as Array<[{ create: { orgAggregate: boolean }; update: { orgAggregate: boolean } }]>;
    expect(first![0].create.orgAggregate).toBe(false);
    expect(first![0].update.orgAggregate).toBe(false);
    expect(second![0].create.orgAggregate).toBe(true);
    expect(second![0].update.orgAggregate).toBe(true);
  });
});
