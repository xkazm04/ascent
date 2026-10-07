// The shared public org has no owner, but hasOrgRole("public", "owner") resolves true for any signed-in
// viewer. The Settings tab must render the non-owner view for it: no erase card, no retention, no plan
// controls (security scan 2026-10-07, O14). The gate is in the tab, not in hasOrgRole.

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/authz", () => ({ hasOrgRole: vi.fn(async () => true) }));
vi.mock("@/lib/db", () => ({
  getOrgLlmConfig: vi.fn(async () => null),
  getCreditState: vi.fn(async () => null),
}));
vi.mock("@/lib/db/retention", () => ({ getOrgRetention: vi.fn(async () => null) }));
vi.mock("@/lib/crypto/secret-box", () => ({ isEncryptionConfigured: () => true }));
vi.mock("@/lib/theme/server", () => ({ getTheme: vi.fn(async () => "altimeter") }));
vi.mock("@/lib/polar", () => ({ polarEnabled: vi.fn(() => true) }));
vi.mock("@/lib/llm/lane-routes-load", () => ({ loadLaneRouting: vi.fn(async () => ({ current: [], preview: null })) }));

import { SettingsTab } from "./SettingsTab";
import { OrgEmpty } from "@/components/org/shared/ui";

const html = async (slug: string) => renderToStaticMarkup((await SettingsTab({ slug })) as React.ReactElement);

describe("SettingsTab on the shared public org", () => {
  it.each(["public", "Public", " public "])("renders only the Owner-only state for %j", async (slug) => {
    const out = await html(slug);
    expect(out).toMatch(/Owner only/i);
    expect(out).not.toMatch(/erase|retention|manage billing/i);
  });

  it("control: a real org's owner still gets the settings, not the Owner-only state", async () => {
    const el = (await SettingsTab({ slug: "acme" })) as React.ReactElement;
    expect(el.type).not.toBe(OrgEmpty);
  });
});
