// The READ-BACK half of the `.ai/` standard (moonshot #13). Ascent authors the repo's agent-facing
// contract (`manifest.ts`) and, until this module, never read it again: the scanner ignored
// `.ai/manifest.yaml`, the onboarding skill re-guessed the repo's commands from its primary language,
// and the doctor's proven `verified` flags never left the repo. `ManifestReadout` is what the scan
// SEES in the repo's own declared contract — display-only, never scored (G5), never in the LLM prompt.
//
// Wire-safe by construction: NOTHING here is a `Date`. `generatedAt` is the manifest's own
// YYYY-MM-DD string and `readAt` is an ISO string stamped at compose time, so the type crosses to a
// client (via `OrgRepoRow.manifest`) without the `row.readAt.getTime()` trap AGENTS.md forbids.

import type { RepoSnapshot } from "@/lib/types";
import { readManifestYaml } from "./read";

/** Whether the repo's manifest could be read at all. `absent` and `unreadable` are DIFFERENT facts. */
export type ReadoutStatus = "ok" | "unreadable" | "absent";

/** Where a control is declared to be enforced. Mirrors `ManifestData["controls"]`'s two keys. */
export type ControlPlacement = "prePush" | "ciHardPass";

export interface CapabilityReadout {
  name: string;
  command: string;
  /** true/false as DECLARED by the doctor's `--run` write-back; null when the key was absent.
   *  null means "not run", which is NOT false ("ran and failed") — honest nulls (G4). */
  verified: boolean | null;
  /** The command still carries a `<placeholder>` — declared but not fillable. */
  placeholder: boolean;
  /** Where this capability is enforced, from `controls`. `[]` means declared nowhere. */
  wiredAt: ControlPlacement[];
}

export interface ManifestReadout {
  status: ReadoutStatus;
  /** ISO string stamped at compose time. NEVER a `Date` (wire-safe-dates). */
  readAt: string;
  /** The manifest's own YYYY-MM-DD, or null when it declares none. */
  generatedAt: string | null;
  schemaVersion: string | null;
  /** Major-version mismatch with MANIFEST_SCHEMA_VERSION — parsed leniently, flagged honestly. */
  schemaAhead: boolean;
  capabilities: CapabilityReadout[];
  controls: { prePush: string[]; ciHardPass: string[] };
  paths: Record<string, string>;
  agents: { id: string; kind: string; entrypoint: string }[];
  /** `repo.purpose` as the human wrote it, or null. Carried so REGENERATION cannot overwrite a real
   *  sentence with the generator's `TODO:` placeholder — a round-trip that loses the human's edit is
   *  the fastest way to teach a maintainer never to re-run the tool. */
  purpose: string | null;
  /** `boundaries`, likewise carried through regeneration rather than reset to the TODO seed. */
  boundaries: { neverTouch: string[]; secretsFrom: string | null };
  /** `generatedFrom` entries that are still `<placeholder>` shaped. */
  placeholders: string[];
  /** `controls.*` entries with no backing capability — the declared-vs-declared gap. */
  unbacked: string[];
  /** Parse notes, never thrown; capped at 10. */
  notes: string[];
}

/** The manifest path the standard writes, and the only one this readout looks for. */
export const MANIFEST_PATH = ".ai/manifest.yaml";
/** Accepted alias — a repo that wrote the pointer with the other YAML extension. */
const MANIFEST_PATH_ALT = ".ai/manifest.yml";

/**
 * The readout for a scanned repo. Pure over the snapshot: re-scanning the same commit produces an
 * identical blob, which is why persisting it needs no retention rule of its own.
 *
 * DEGRADES HONESTLY. No manifest among the fetched files → `status: "absent"` with empty
 * capabilities, so the UI renders "—" and never `0/0 verified`. A manifest that is present but
 * unparseable → `status: "unreadable"` with a note. Neither ever fails the scan.
 *
 * NOTE the ordering dependency this module cannot enforce: the file only reaches `snap.files` when
 * `pickFilesToFetch` requests it. Until that lands, every readout is honestly `absent` — which is the
 * correct degrade, not a silent zero.
 */
export function buildManifestReadout(snap: RepoSnapshot, now?: string): ManifestReadout {
  const readAt = now ?? new Date().toISOString();
  const file = snap.files.find((f) => f.path === MANIFEST_PATH || f.path === MANIFEST_PATH_ALT);
  if (!file) return absentReadout(readAt);
  const out = readManifestYaml(file.content);
  return { ...out, readAt };
}

/** The honest "we did not see a manifest" readout — never a zeroed one. */
export function absentReadout(readAt: string): ManifestReadout {
  return {
    status: "absent",
    readAt,
    generatedAt: null,
    schemaVersion: null,
    schemaAhead: false,
    capabilities: [],
    controls: { prePush: [], ciHardPass: [] },
    paths: {},
    agents: [],
    purpose: null,
    boundaries: { neverTouch: [], secretsFrom: null },
    placeholders: [],
    unbacked: [],
    notes: [],
  };
}

/**
 * Defensive parse of a persisted `manifestJson` blob — null on malformed/legacy content, mirroring
 * `parseContextHealthJson`. A row written before the column shipped reads as "not assessed by this
 * scan", never as a repo with no contract.
 */
export function parseManifestReadoutJson(raw: string | null | undefined): ManifestReadout | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ManifestReadout>;
    if (!v || typeof v !== "object") return null;
    if (v.status !== "ok" && v.status !== "unreadable" && v.status !== "absent") return null;
    if (typeof v.readAt !== "string") return null;
    return {
      status: v.status,
      readAt: v.readAt,
      generatedAt: typeof v.generatedAt === "string" ? v.generatedAt : null,
      schemaVersion: typeof v.schemaVersion === "string" ? v.schemaVersion : null,
      schemaAhead: v.schemaAhead === true,
      capabilities: Array.isArray(v.capabilities) ? v.capabilities : [],
      controls: {
        prePush: Array.isArray(v.controls?.prePush) ? v.controls.prePush : [],
        ciHardPass: Array.isArray(v.controls?.ciHardPass) ? v.controls.ciHardPass : [],
      },
      paths: v.paths && typeof v.paths === "object" ? v.paths : {},
      agents: Array.isArray(v.agents) ? v.agents : [],
      purpose: typeof v.purpose === "string" ? v.purpose : null,
      boundaries: {
        neverTouch: Array.isArray(v.boundaries?.neverTouch) ? v.boundaries.neverTouch : [],
        secretsFrom: typeof v.boundaries?.secretsFrom === "string" ? v.boundaries.secretsFrom : null,
      },
      placeholders: Array.isArray(v.placeholders) ? v.placeholders : [],
      unbacked: Array.isArray(v.unbacked) ? v.unbacked : [],
      notes: Array.isArray(v.notes) ? v.notes : [],
    };
  } catch {
    return null;
  }
}

/** Capabilities the doctor has actually PROVEN (`verified: true`) — the "proven" half of the matrix. */
export function verifiedCapabilities(readout: ManifestReadout | null): CapabilityReadout[] {
  return (readout?.capabilities ?? []).filter((c) => c.verified === true);
}
