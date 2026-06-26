// gatePolicy is persisted as SERIALIZED JSON in a TEXT column (the schema's no-jsonb DSQL-safety
// contract) and parsed at this edge — these tests pin that round-trip: a write stores a JSON STRING,
// a read JSON.parses it back, and a read tolerates a legacy jsonb row that comes back as an object.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));

vi.mock("@/lib/db/client", () => ({
  getPrisma: mockGetPrisma,
  isDbConfigured: () => true,
}));

import { getOrgGatePolicy, setOrgGatePolicy } from "./org-gate";

describe("org-gate gatePolicy TEXT (serialized JSON) persistence", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
  });

  it("setOrgGatePolicy stores the sanitized policy as a JSON STRING, not a jsonb object", async () => {
    let writtenData: { gatePolicy?: unknown } | undefined;
    mockGetPrisma.mockReturnValue({
      organization: {
        findUnique: vi.fn(async () => ({ id: "org_1" })),
        update: vi.fn(async ({ data }: { data: { gatePolicy?: unknown } }) => {
          writtenData = data;
          return {};
        }),
      },
    });

    const result = await setOrgGatePolicy("acme", { minOverall: 70 });

    expect(result).toMatchObject({ minOverall: 70 });
    expect(typeof writtenData!.gatePolicy).toBe("string"); // serialized, not an object
    expect(JSON.parse(writtenData!.gatePolicy as string)).toMatchObject({ minOverall: 70 });
  });

  it("setOrgGatePolicy(null) clears the column with an explicit null (not jsonb DbNull)", async () => {
    let writtenData: { gatePolicy?: unknown } | undefined;
    mockGetPrisma.mockReturnValue({
      organization: {
        findUnique: vi.fn(async () => ({ id: "org_1" })),
        update: vi.fn(async ({ data }: { data: { gatePolicy?: unknown } }) => {
          writtenData = data;
          return {};
        }),
      },
    });

    await setOrgGatePolicy("acme", null);
    expect(writtenData!.gatePolicy).toBeNull();
  });

  it("getOrgGatePolicy JSON.parses the stored TEXT string back into a policy", async () => {
    mockGetPrisma.mockReturnValue({
      organization: {
        findUnique: vi.fn(async () => ({ gatePolicy: JSON.stringify({ minOverall: 80 }) })),
      },
    });

    const policy = await getOrgGatePolicy("acme");
    expect(policy).toMatchObject({ minOverall: 80 });
  });

  it("getOrgGatePolicy tolerates a legacy jsonb row read back as an object (migration safety)", async () => {
    mockGetPrisma.mockReturnValue({
      organization: {
        findUnique: vi.fn(async () => ({ gatePolicy: { minOverall: 60 } })),
      },
    });

    const policy = await getOrgGatePolicy("acme");
    expect(policy).toMatchObject({ minOverall: 60 });
  });

  it("getOrgGatePolicy returns null for corrupt non-JSON TEXT", async () => {
    mockGetPrisma.mockReturnValue({
      organization: {
        findUnique: vi.fn(async () => ({ gatePolicy: "not json{" })),
      },
    });

    expect(await getOrgGatePolicy("acme")).toBeNull();
  });
});
