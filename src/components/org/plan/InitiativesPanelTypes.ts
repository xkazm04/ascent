// Types for the Initiatives panel (InitiativesPanel.tsx) — split out per the `<Feature>Types.ts`
// convention (docs/ORG-TABS-REFACTOR.md §3) so the component file stays JSX + wiring only.

export interface InitiativeView {
  id: string;
  title: string;
  dimId: string;
  dimLabel: string;
  practiceId: string | null;
  targetScore: number;
  repos: string[];
  status: string;
  assigneeLogin: string | null;
  targetDate: string | null;
  goalId: string | null;
  goalLabel: string | null;
  playbookId: string | null;
  playbookLabel: string | null;
  progress: { atTarget: number; total: number };
}

export interface SeedRec {
  title: string;
  dimId: string;
  dimLabel: string;
  practiceId: string | null; // the dimension's reusable practice — for the starter shape
  repos: string[]; // fullNames in scope
  repoCount: number;
}

export interface GoalOption {
  id: string;
  label: string;
}
