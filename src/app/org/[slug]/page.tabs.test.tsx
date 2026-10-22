// The org page routes every `?tab=` id by its declared reach: a panel renders in the shell with no
// redirect, an alias redirects to its target carrying the other params, the route id redirects to its
// standalone page. Pins the deletion of the migration seam (a valid id redirected to a legacy route).

import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, chunks } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  chunks: vi.fn(() => null),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/components/org/shell/OrgTabChunks", () => ({ OrgTabChunks: chunks }));
vi.mock("@/lib/db", () => ({
  countInFlightPrs: vi.fn(async () => 0),
  getOrgHeaderSummary: vi.fn(async () => ({ scannedCount: 3, repoCount: 3, avgOverall: 60 })),
}));
vi.mock("@/lib/authz", () => ({ canReadOrg: async () => true }));

import OrgDashboardPage from "./page";
import { ORG_TAB_IDS, orgTabReach } from "@/lib/org/orgTabs";

async function render(sp: Record<string, string>) {
  return OrgDashboardPage({ params: Promise.resolve({ slug: "acme" }), searchParams: Promise.resolve(sp) });
}

/** The props the page handed to OrgTabChunks (the element's own props: the page returns `<OrgTabChunks/>`). */
function propsOf(el: unknown): { tab: string; slug: string } {
  return (el as { props: { tab: string; slug: string } }).props;
}

beforeEach(() => {
  redirect.mockClear();
});

describe("org page tab routing", () => {
  const panels = ORG_TAB_IDS.filter((id) => orgTabReach(id).kind === "panel");

  it("renders every panel id in the shell and never redirects", async () => {
    expect(panels).toHaveLength(26);
    for (const id of panels) {
      const el = await render({ tab: id });
      expect(propsOf(el).tab, id).toBe(id);
      expect(propsOf(el).slug).toBe("acme");
    }
    expect(redirect).not.toHaveBeenCalled();
  });

  it("renders ?tab=segments as its own panel id (Repositories in segments mode)", async () => {
    const el = await render({ tab: "segments" });
    expect(propsOf(el).tab).toBe("segments");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects the followups alias to proposals, carrying the period", async () => {
    await expect(render({ tab: "followups", range: "90d" })).rejects.toThrow("REDIRECT");
    const url = new URL(String(redirect.mock.calls[0]?.[0]), "https://x.test");
    expect(url.pathname).toBe("/org/acme");
    expect(url.searchParams.get("tab")).toBe("proposals");
    expect(url.searchParams.get("range")).toBe("90d");
  });

  it("redirects the surfaces alias to the Knowledge base section", async () => {
    await expect(render({ tab: "surfaces", subject: "table" })).rejects.toThrow("REDIRECT");
    const url = new URL(String(redirect.mock.calls[0]?.[0]), "https://x.test");
    expect(url.searchParams.get("tab")).toBe("knowledge");
    expect(url.searchParams.get("section")).toBe("surfaces");
    expect(url.searchParams.get("subject")).toBe("table");
  });

  it("redirects ?tab=developer to the personalized route", async () => {
    await expect(render({ tab: "developer" })).rejects.toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/org/developer?org=acme");
  });

  it("an unknown tab falls back to the landing panel without a redirect", async () => {
    const el = await render({ tab: "nope" });
    expect(propsOf(el).tab).toBe("overview");
    expect(redirect).not.toHaveBeenCalled();
  });
});
