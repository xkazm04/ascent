// What the Security tab reads once on the server and hands to a composition.
// The derived values (markdown brief, CI gate snippet, advisory rows, the degraded flag) are computed ONCE in
// the entry so the two compositions cannot disagree about what the register shows.
import type { ComponentProps } from "react";
import type { SecurityOverview } from "@/lib/org/security";
import type { DecisionMap } from "@/lib/org/decision-map";
import type { TechStackSelector } from "@/components/shared/scope/TechStackSelector";
import type { RegisterAdvisories } from "./securityRegisterShared";

export interface SecurityTabData {
  slug: string;
  sec: SecurityOverview;
  decisions: DecisionMap;
  /** The security brief for "Copy for LLM". */
  md: string;
  /** Paste-ready CI enforcement for this fleet, built from the full register. */
  gateSnippet: string;
  /** null = supply-chain scanning off; [] = on but nothing found. */
  advisories: RegisterAdvisories[] | null;
  advisoriesDemo: boolean;
  /** The advisory fetch failed: "we could not look" must never read as a pass. */
  supplyDegraded: boolean;
  pdfHref: string;
  comparisonLabel: string;
  stack: Pick<ComponentProps<typeof TechStackSelector>, "groups" | "active">;
}
