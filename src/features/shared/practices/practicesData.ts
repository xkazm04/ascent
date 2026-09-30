// The practices tab's server payload, shared by both compositions. Shaping stays here so Prism
// cannot grow a second query or a second reading of the same rows.
import type { OrgPractice, PlaybookAdoption, PlaybookRow, TechGroupSummary } from "@/lib/db";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";
import type { PracticeAdoptionSummary } from "@/lib/db/practice-adoption";
import type { PracticeShapeRow } from "@/lib/db/org-practice-shapes";
import type { PracticeLibrarySummary } from "@/lib/org/practice-library";
import type { MinedPractice } from "@/lib/org/practice-mining";
import type { RegistrySync } from "@/lib/org/registry-sync";
import type { RepoCoherenceRow } from "./foundation/guidanceCoherenceModel";

export interface PracticeDimOption {
  id: string;
  label: string;
}

export interface PracticesPageData {
  slug: string;
  sync: RegistrySync;
  techGroups: TechGroupSummary[];
  activeStack: TechGroupSummary | null;
  brief: string;
  mined: MinedPractice[] | null;
  reposWithShape: number;
  shapeRows: readonly PracticeShapeRow[];
  registryBase: string | null;
  repoOptions: string[];
  summary: PracticeLibrarySummary;
  adoptionLedger: PracticeAdoptionSummary | null;
  playbooks: PlaybookRow[];
  practices: OrgPractice[];
  adoption: Record<string, PlaybookAdoption>;
  dimOptions: PracticeDimOption[];
  foundationRows: FoundationRolloutRow[];
  coherence: RepoCoherenceRow[] | null;
}
