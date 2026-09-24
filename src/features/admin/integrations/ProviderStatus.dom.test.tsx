// @vitest-environment jsdom
//
// The status line under a provider card is keyed on the ROW's fidelity. Backlog row 47 made OpenAI
// (allocated, admin-pull, org-scope records) available, and the line had only two shapes: seats-only
// (Copilot) and repo-attributed (Claude OTel). A synced OpenAI org stores org-scope rows only, so it
// fell into the repo branch and was told, in orange, to fix its OTEL_RESOURCE_ATTRIBUTES; before a
// sync it was told to pull "seats and engagement", which OpenAI never reports.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PROVIDERS } from "@/lib/integrations/providers";
import type { ProviderIngestStatus } from "@/lib/db";
import { ProviderStatus } from "./ProviderStatus";

const openai = PROVIDERS.find((p) => p.id === "openai")!;
const copilot = PROVIDERS.find((p) => p.id === "copilot")!;

const synced: ProviderIngestStatus = {
  source: "openai",
  lastReceived: new Date("2026-09-24T10:00:00Z"),
  repos: 0,
  costCents: 137_900,
  tokens: 0,
  seats: 0,
  sessions: 0,
  measured: false,
};

describe("ProviderStatus: an allocated admin-pull provider (OpenAI)", () => {
  it("before a sync, asks for the admin key and a sync, not for seats and engagement", () => {
    const { container } = render(<ProviderStatus provider={openai} status={null} />);
    expect(container.textContent).toMatch(/admin key/i);
    expect(container.textContent).not.toMatch(/seats and engagement/);
  });

  it("after a sync, reports the sync as org-level allocated cost, with no repo-attribution alarm", () => {
    const { container } = render(<ProviderStatus provider={openai} status={synced} />);
    expect(container.textContent).toMatch(/Last synced/);
    expect(container.textContent).toMatch(/allocated/i);
    expect(container.textContent).not.toMatch(/OTEL_RESOURCE_ATTRIBUTES/);
    expect(container.textContent).not.toMatch(/nothing landed on a repository/);
  });
});

describe("ProviderStatus: guards", () => {
  it("guard: Copilot's first action still names seats and engagement", () => {
    const { container } = render(<ProviderStatus provider={copilot} status={null} />);
    expect(container.textContent).toMatch(/seats and engagement/);
  });
});
