import { describe, expect, it } from "vitest";
import { getRedirectUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import nextConfig from "../../../next.config";
import { isOrgTabId, ORG_NAV_GROUPS, PERSONAL_TAB_IDS, isMigratedOrgTab } from "./orgTabs";

describe("promoted surface library", () => {
  it("permanently redirects the experimental URL, preserving deep links and scope", async () => {
    const response = await unstable_getResponseFromNextConfig({
      url: "https://ascent.test/org/studio?tab=knowledge-v2&subject=table&technique=pagination&range=90d&segment=frontend",
      nextConfig,
    });
    expect(response.status).toBe(308);
    const url = new URL(getRedirectUrl(response)!);
    expect(url.pathname).toBe("/org/studio");
    expect(url.searchParams.getAll("tab")).toEqual(["surfaces"]);
    expect(url.searchParams.get("subject")).toBe("table");
    expect(url.searchParams.get("technique")).toBe("pagination");
    expect(url.searchParams.get("range")).toBe("90d");
    expect(url.searchParams.get("segment")).toBe("frontend");
    // Repeated keys are covered against the live server: this experimental Next helper
    // serializes arrays to comma-joined strings, unlike the actual redirect router.
  });

  it("does not redirect the canonical tab or unrelated destinations", async () => {
    for (const path of ["/org/studio", "/org/studio?tab=surfaces", "/org/studio?tab=knowledge", "/about?tab=knowledge-v2"]) {
      const response = await unstable_getResponseFromNextConfig({ url: `https://ascent.test${path}`, nextConfig });
      expect(getRedirectUrl(response)).toBeNull();
    }
  });

  it("has one surface navigation entry for org and personal workspaces", () => {
    expect(isOrgTabId("knowledge-v2")).toBe(false);
    expect(ORG_NAV_GROUPS.flatMap(g => g.items).filter(i => i.id === "surfaces")).toEqual([
      { id: "surfaces", label: "UI surfaces" },
    ]);
    expect(PERSONAL_TAB_IDS.has("surfaces")).toBe(true);
    expect(isMigratedOrgTab("surfaces")).toBe(true);
  });
});
