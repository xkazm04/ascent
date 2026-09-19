// Shared, PURE tech-stack display + grouping helpers (Features 3a/3b). Used by the leaderboard badges
// (display) and the tech-group sync/selector (grouping). Keeping the role labels + the role→group-key
// mapping in one place means the badge a user sees and the group they filter by never drift.

import type { StackRole, TechStack } from "@/lib/types";

export const STACK_ROLE_LABEL: Record<StackRole, string> = {
  frontend: "Frontend",
  backend: "Backend",
  mobile: "Mobile",
  data_ml: "Data / ML",
  infra: "Infra",
  library: "Library",
  unknown: "Unknown",
};

/** Compact chips summarizing a stack: role labels (Backend shows its language) then a few frameworks. */
export function techChips(stack: TechStack, maxFrameworks = 3): string[] {
  const chips = stack.roles
    .filter((r) => r !== "unknown")
    .map((r) => (r === "backend" && stack.backendLanguage ? `Backend·${stack.backendLanguage}` : STACK_ROLE_LABEL[r]));
  for (const f of stack.frameworks.slice(0, maxFrameworks)) chips.push(f);
  return chips;
}

export interface TechGroupKey {
  key: string;
  label: string;
}

/**
 * The stable tech-group keys a repo belongs to, derived from its roles + backend language. Backend is
 * per-language ("backend:node", "backend:python" — §8.11); the other roles map 1:1. Multi-membership:
 * a fullstack repo yields several keys (frontend AND backend:node). `unknown` is dropped (no group).
 * The key is the durable identity used by TechStackGroup.key; the label is for display.
 */
export function techGroupsFor(stack: TechStack | null | undefined): TechGroupKey[] {
  if (!stack) return [];
  const out: TechGroupKey[] = [];
  const seen = new Set<string>();
  for (const role of stack.roles) {
    if (role === "unknown") continue;
    let entry: TechGroupKey;
    if (role === "backend") {
      const lang = stack.backendLanguage?.trim();
      entry = lang
        ? { key: `backend:${lang.toLowerCase()}`, label: `Backend · ${lang}` }
        : { key: "backend", label: "Backend" };
    } else {
      entry = { key: role, label: STACK_ROLE_LABEL[role] };
    }
    if (!seen.has(entry.key)) {
      seen.add(entry.key);
      out.push(entry);
    }
  }
  return out;
}

/** Display label for a tech-group key (round-trips techGroupsFor keys; tolerant of legacy/unknown). */
export function techGroupLabel(key: string): string {
  if (key.startsWith("backend:")) {
    const lang = key.slice("backend:".length);
    return `Backend · ${lang.charAt(0).toUpperCase()}${lang.slice(1)}`;
  }
  return STACK_ROLE_LABEL[key as StackRole] ?? key.replace(/[-_:]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
