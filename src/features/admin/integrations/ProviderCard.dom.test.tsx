// @vitest-environment jsdom
//
// The Available catalog row is ProviderCard rendering PROVIDERS[].capabilities. Unimplemented
// Claude bullets used to appear here with no ingest consumer. FAIL-BEFORE: restoring
// "Per-user sessions, lines, commits, PRs" or "Admin Usage/Cost totals (optional, next)" on the
// Claude registry row puts that copy back in the DOM.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PROVIDERS } from "@/lib/integrations/providers";
import { ProviderCard } from "./ProviderCard";

const claude = PROVIDERS.find((p) => p.id === "claude-code")!;

describe("ProviderCard — Claude Available catalog row", () => {
  it("lists per-repo tokens & cost and omits unimplemented capabilities", () => {
    render(<ProviderCard provider={claude} />);
    const card = document.querySelector('[data-provider="claude-code"]');
    expect(card).not.toBeNull();
    expect(screen.getByText("Per-repo tokens & cost (OTel git.repository)")).toBeTruthy();
    expect(screen.queryByText("Per-user sessions, lines, commits, PRs")).toBeNull();
    expect(screen.queryByText("Admin Usage/Cost totals (optional, next)")).toBeNull();
    expect(screen.queryByText(/optional, next/i)).toBeNull();
  });
});
