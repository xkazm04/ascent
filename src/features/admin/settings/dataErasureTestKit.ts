// Shared fixtures + DOM selectors for the two DataErasureCard test files (arming and outcomes).
// Test-only, co-located: it exists so each sibling can keep its own `@vitest-environment` pragma and
// its own render/mock lifecycle while both stay under the 200-LOC `src/features/**` cap. Nothing
// here mocks anything by itself — the lifecycle stays in each test file, where it is readable.

import { vi } from "vitest";
import { screen } from "@testing-library/react";

/** The `preview: true` body the dialog fetches on open. The confirm button is dead until this lands,
 *  so every test has to get past it before it can exercise anything else. */
export const PREVIEW = {
  orgSlug: "acme",
  scope: "org" as const,
  reposProcessed: 3,
  scansDeleted: 120,
  dimensionsDeleted: 1080,
  recommendationsDeleted: 340,
  recommendationEventsDeleted: 12,
  auditDeleted: 0,
  auditRedacted: 0,
  auditDisposition: "keep" as const,
  stoppedEarly: false,
  complete: true,
  audited: true,
  dryRun: true,
};

/** A clean 200 erase result, with the audit fields the server actually sends. */
export const OK = {
  orgSlug: "acme",
  scope: "org" as const,
  reposProcessed: 3,
  scansDeleted: 120,
  dimensionsDeleted: 1080,
  recommendationsDeleted: 340,
  recommendationEventsDeleted: 12,
  auditDeleted: 0,
  auditRedacted: 0,
  auditDisposition: "keep" as const,
  stoppedEarly: false,
  complete: true,
  audited: true,
};

export function mockPost(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export const eraseButton = () => screen.getByRole("button", { name: /erase organization data…/i });
export const confirmInput = () => screen.getByPlaceholderText("acme") as HTMLInputElement;
export const submit = () => screen.getByRole("button", { name: /^erase acme$/i }) as HTMLButtonElement;
