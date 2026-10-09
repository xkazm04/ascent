// @vitest-environment node
//
// The "Repository data" paragraph must disclose that private reports keep the AI's written
// commentary (operator decision 2026-10-09, docs/adr/2026-10-08-private-scan-stores-no-file-text.md),
// and must no longer claim that private reports store no text derived from the files.

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The shared site chrome needs a request context; it is not what this page owns.
vi.mock("@/components/Brand", () => ({
  SiteHeader: () => <header />,
  SiteFooter: () => <footer />,
}));

import PrivacyPage from "./page";

function pageText(): string {
  return renderToStaticMarkup(<PrivacyPage />)
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

describe("/privacy repository data", () => {
  it("discloses the stored commentary for private reports", () => {
    const text = pageText();
    expect(text).toContain("keep the AI's written commentary about the repository");
    expect(text).toContain("the headline, strengths and risks");
    expect(text).toContain("can echo short passages of them");
    expect(text).toContain("copied quotes are removed");
    expect(text).toContain("no text from the files is stored");
  });

  it("no longer claims private reports store no text from the files", () => {
    const text = pageText();
    expect(text).not.toContain("reports on private repositories store none");
  });

  it("carries the new last-updated date", () => {
    expect(pageText()).toContain("Last updated: October 9, 2026");
  });
});
