// Pins the ownership shape of the org data-erasure control (G2-34): it is rendered for an owner and is
// ABSENT — not merely disabled — for everyone else. A disabled irreversible control is an invitation to
// go hunt for the permission; the tab's owner gate is what makes absence real, so the gate and the
// control's placement behind it are pinned together here.
//
// Moved from src/app/org/[slug]/settings/page.test.tsx alongside the Settings tab's migration into the
// org dashboard's `?tab=` shell (docs/ORG-TABS-REFACTOR.md) — the route is now a redirect() and no
// longer owns this render, so the pin follows the component to SettingsTab.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { mockHasOrgRole } = vi.hoisted(() => ({ mockHasOrgRole: vi.fn() }));

vi.mock("@/lib/authz", () => ({ hasOrgRole: mockHasOrgRole }));
vi.mock("@/lib/db", () => ({
  getOrgLlmConfig: vi.fn(async () => null),
  getCreditState: vi.fn(async () => null),
}));
vi.mock("@/lib/db/retention", () => ({ getOrgRetention: vi.fn(async () => null) }));
vi.mock("@/lib/crypto/secret-box", () => ({ isEncryptionConfigured: () => true }));

import { SettingsTab } from "./SettingsTab";
import { DataErasureCard } from "./DataErasureCard";
import { RetentionCard } from "./RetentionCard";

function findType(node: React.ReactNode, type: unknown): React.ReactElement | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findType(child, type);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as React.ReactElement<{ children?: React.ReactNode }>;
  if (el.type === type) return el;
  return findType(el.props?.children ?? null, type);
}

async function renderTab() {
  return (await SettingsTab({ slug: "acme" })) as React.ReactElement;
}

beforeEach(() => {
  mockHasOrgRole.mockReset();
});

describe("SettingsTab — data erasure placement", () => {
  it("renders the erase control for an owner, scoped to this org", async () => {
    mockHasOrgRole.mockResolvedValue(true);

    const card = findType(await renderTab(), DataErasureCard);

    expect(card).not.toBeNull();
    expect((card!.props as { slug: string }).slug).toBe("acme");
    expect(mockHasOrgRole).toHaveBeenCalledWith("acme", "owner");
  });

  it("renders NO erase control at all for a non-owner (absent, not disabled)", async () => {
    mockHasOrgRole.mockResolvedValue(false);

    const el = await renderTab();

    expect(findType(el, DataErasureCard)).toBeNull();
    // Belt: nothing in the rendered non-owner page even mentions erasure.
    const html = renderToStaticMarkup(el);
    expect(html).not.toMatch(/erase/i);
    expect(html).toMatch(/Owner only/i);
  });
});

describe("SettingsTab — retention placement", () => {
  it("renders the retention control for an owner, scoped to this org", async () => {
    mockHasOrgRole.mockResolvedValue(true);

    const card = findType(await renderTab(), RetentionCard);

    expect(card).not.toBeNull();
    expect((card!.props as { slug: string }).slug).toBe("acme");
    expect(mockHasOrgRole).toHaveBeenCalledWith("acme", "owner");
  });

  it("renders NO retention control at all for a non-owner (absent, not disabled)", async () => {
    mockHasOrgRole.mockResolvedValue(false);

    const el = await renderTab();

    expect(findType(el, RetentionCard)).toBeNull();
    const html = renderToStaticMarkup(el);
    expect(html).not.toMatch(/retention/i);
    expect(html).toMatch(/Owner only/i);
  });
});
