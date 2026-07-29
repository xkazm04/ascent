// Pins the ownership shape of the org data-erasure control (G2-34): it is rendered for an owner and is
// ABSENT — not merely disabled — for everyone else. A disabled irreversible control is an invitation to
// go hunt for the permission; the settings page's owner gate is what makes absence real, so the gate and
// the control's placement behind it are pinned together here.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { mockHasOrgRole } = vi.hoisted(() => ({ mockHasOrgRole: vi.fn() }));

vi.mock("@/lib/authz", () => ({ hasOrgRole: mockHasOrgRole }));
vi.mock("@/lib/db", () => ({
  getOrgLlmConfig: vi.fn(async () => null),
  getCreditState: vi.fn(async () => null),
}));
vi.mock("@/lib/crypto/secret-box", () => ({ isEncryptionConfigured: () => true }));

import OrgSettings from "./page";
import { DataErasureCard } from "@/components/org/settings/DataErasureCard";

function findCard(node: React.ReactNode): React.ReactElement | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findCard(child);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as React.ReactElement<{ children?: React.ReactNode }>;
  if (el.type === DataErasureCard) return el;
  return findCard(el.props?.children ?? null);
}

async function renderPage() {
  return (await OrgSettings({ params: Promise.resolve({ slug: "acme" }) })) as React.ReactElement;
}

beforeEach(() => {
  mockHasOrgRole.mockReset();
});

describe("OrgSettings — data erasure placement", () => {
  it("renders the erase control for an owner, scoped to this org", async () => {
    mockHasOrgRole.mockResolvedValue(true);

    const card = findCard(await renderPage());

    expect(card).not.toBeNull();
    expect((card!.props as { slug: string }).slug).toBe("acme");
    expect(mockHasOrgRole).toHaveBeenCalledWith("acme", "owner");
  });

  it("renders NO erase control at all for a non-owner (absent, not disabled)", async () => {
    mockHasOrgRole.mockResolvedValue(false);

    const el = await renderPage();

    expect(findCard(el)).toBeNull();
    // Belt: nothing in the rendered non-owner page even mentions erasure.
    const html = renderToStaticMarkup(el);
    expect(html).not.toMatch(/erase/i);
    expect(html).toMatch(/Owner only/i);
  });
});
