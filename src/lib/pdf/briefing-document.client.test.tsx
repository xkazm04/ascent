// value-1 (executive-briefing-export council r1): a per-client briefing is the deliverable a reseller
// hands its CLIENT, and it used to name the reseller's own account in its title and heading. The
// client's name (segmentName, set by buildExecBriefing on a segment-scoped build) now titles both; the
// org stays the issuer, so the brand kicker and the document author do not change.

import { describe, it, expect } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { BriefingDocument } from "./briefing-document";
import { briefing, tree, textOf } from "./briefing-document.test-helpers";
import { baseStyles } from "./theme";

type DocProps = { title?: string; author?: string };
const doc = (b: ReturnType<typeof briefing>, brandName: string | null = null) => {
  const el = BriefingDocument({ briefing: b, branding: brandName ? { brandName, brandColor: null, logoUrl: null } : undefined });
  if (!isValidElement(el)) throw new Error("BriefingDocument did not return an element");
  return (el as ReactElement<DocProps>).props;
};
const h1 = (b: ReturnType<typeof briefing>) => tree(b).filter((n) => n.props.style === baseStyles.h1).map((n) => textOf(n));

describe("BriefingDocument — a per-client briefing names its client", () => {
  it("titles the PDF and prints the h1 with the client, not the reseller's org", () => {
    const b = briefing({ segmentName: "Globex Corp" });
    expect(doc(b).title).toBe("Ascent executive briefing — Globex Corp");
    expect(h1(b)).toEqual(["Globex Corp"]);
  });

  it("keeps the org as the issuer: brand label and author are unchanged", () => {
    const b = briefing({ segmentName: "Globex Corp" });
    expect(doc(b, "Northwind MSP").author).toBe("Northwind MSP");
    expect(doc(b, "Northwind MSP").title).toBe("Northwind MSP executive briefing — Globex Corp");
    expect(doc(b).author).toBe("Ascent");
  });

  it("an unscoped briefing renders exactly as before: the org titles both", () => {
    for (const b of [briefing(), briefing({ segmentName: null })]) {
      expect(doc(b).title).toBe("Ascent executive briefing — acme");
      expect(h1(b)).toEqual(["acme"]);
    }
  });

  it("a non-Latin-1 client name shows a visible '?' rather than vanishing from the heading", () => {
    expect(h1(briefing({ segmentName: "Kraków 東京" }))[0]).toMatch(/^Krak.w \?+$/);
  });
});
