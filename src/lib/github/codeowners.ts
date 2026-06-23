// CODEOWNERS → team attribution. Parses a repo's CODEOWNERS file (already fetched into the scan
// snapshot — it's a high-signal file in source.ts's ingestion budget) into the set of teams that
// own part of the repo. That attribution is persisted per repo (RepoTeam) and aggregated into the
// org's team-level rollups (getOrgTeamRollup) — turning a repo-centric fleet view into one that
// maps to how the org is actually structured.
//
// Pure + I/O-free so it stays unit-testable: callers pass the CODEOWNERS content (or the snapshot's
// fetched files) and get back normalized TeamOwnership[]. No GitHub calls — the scan already read
// the file.

import type { TeamOwnership } from "@/lib/types";

// A code-owner that is a TEAM mention: "@org/team" (an org/slug pair after the @). Individual
// "@user" owners (no slash) and "email@example.com" owners are deliberately excluded — the rollup's
// unit is the team. GitHub org and team slugs are alphanumerics plus dash/underscore/dot.
const TEAM_RE = /^@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

// The three locations GitHub honors a CODEOWNERS file (root, .github/, docs/), matched
// case-insensitively — mirrors the exact names source.ts fetches into the snapshot.
const CODEOWNERS_PATH_RE = /^(?:\.github\/|docs\/)?codeowners$/i;

/**
 * Parse CODEOWNERS content into the teams that own part of the repo, with how many rules name each
 * team and whether it owns the `*` catch-all (the repo's primary/default owner). Comments
 * (`#`-leading), blank lines, and section headers (`[Section]` / `^[Section]`, CODEOWNERS v2) are
 * ignored; a rule is `pattern owner1 owner2 …`. Owners are de-duplicated within a single rule so a
 * team named twice on one line counts once. Result is sorted by owned-path count (desc), then slug.
 */
export function parseCodeowners(content: string): TeamOwnership[] {
  const teams = new Map<string, { ownedPaths: number; isDefaultOwner: boolean }>();

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue; // blank or comment
    if (line.startsWith("[") || line.startsWith("^[")) continue; // CODEOWNERS v2 section header

    const tokens = line.split(/\s+/);
    const pattern = tokens[0];
    const owners = tokens.slice(1);
    if (owners.length === 0) continue; // a pattern with no owners "unsets" ownership — no team to attribute

    const isDefault = pattern === "*"; // the catch-all rule → the repo's primary owner
    const seenInLine = new Set<string>();
    for (const owner of owners) {
      if (!TEAM_RE.test(owner)) continue; // skip @user and email owners
      const slug = owner.toLowerCase();
      if (seenInLine.has(slug)) continue; // dedupe within the same rule
      seenInLine.add(slug);
      const entry = teams.get(slug) ?? { ownedPaths: 0, isDefaultOwner: false };
      entry.ownedPaths += 1;
      if (isDefault) entry.isDefaultOwner = true;
      teams.set(slug, entry);
    }
  }

  return [...teams.entries()]
    .map(([slug, v]) => ({ slug, ownedPaths: v.ownedPaths, isDefaultOwner: v.isDefaultOwner }))
    .sort((a, b) => b.ownedPaths - a.ownedPaths || a.slug.localeCompare(b.slug));
}

/** Locate a repo's CODEOWNERS content among the snapshot's fetched files (root, .github/, docs/). */
export function findCodeownersContent(files: { path: string; content: string }[]): string | null {
  const hit = files.find((f) => CODEOWNERS_PATH_RE.test(f.path));
  return hit?.content ?? null;
}

/**
 * The team attribution for a scanned repo: find its CODEOWNERS file in the fetched snapshot files
 * and parse the teams out of it. Returns an empty array when the repo has no CODEOWNERS file (or it
 * names no teams) — that's a definitive "no team ownership", which persistence treats as authoritative.
 */
export function extractTeamOwnership(files: { path: string; content: string }[]): TeamOwnership[] {
  const content = findCodeownersContent(files);
  return content ? parseCodeowners(content) : [];
}

/** Display helper for a `@org/team` slug. */
export function teamDisplayName(slug: string): string {
  const seg = slug.split("/")[1];
  return seg && seg.length ? seg : slug.replace(/^@/, "");
}
