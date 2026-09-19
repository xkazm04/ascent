// Client-side types + the one fetch wrapper for the Pairing tab. Mirrors (never imports) the server
// shapes: `LocalPairing` (src/lib/db/org-local.ts) and `PairingCheck` (src/lib/local/pairing.ts) —
// those modules touch prisma/node:fs and must stay out of the client bundle.

export interface PairingView {
  fullName: string;
  localPath: string | null;
  watched: boolean;
  lastScanAt: string | null;
}

export interface PairingCheckView {
  ok: boolean;
  error: string | null;
  originMatch: "match" | "mismatch" | "unknown";
  origin: string | null;
  headSha: string | null;
  branch: string | null;
}

export interface PairingResponse {
  ok?: boolean;
  paired?: boolean;
  check?: PairingCheckView;
  error?: string;
}

/** POST to the pairing route; throws on network failure, returns the parsed body otherwise (the
 *  caller reads `ok`/`error` — a 422 verdict is a RESULT to render, not an exception). */
export async function postPairing(body: {
  org: string;
  fullName: string;
  path: string | null;
  verifyOnly?: boolean;
}): Promise<PairingResponse> {
  const r = await fetch("/api/org/local/pairing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = (await r.json().catch(() => ({}))) as PairingResponse;
  if (!r.ok && !d.check && !d.error) d.error = `Request failed (${r.status}).`;
  return d;
}

// ── the registry step (local first, GitHub optional) ─────────────────────────────────────────────

/** What the Pairing tab knows about the org's registry — built on the server in PairingTab. */
export interface RegistryPairingView {
  /** The canonical registry row's name, or null when nothing is mapped. */
  fullName: string | null;
  /** The paired working copy, or null (unpaired — reads go through GitHub if at all). */
  localPath: string | null;
  /** `registry.local` from this app's own manifest, resolved — the prefill for an unpaired registry. */
  suggestedPath: string | null;
  status: string;
  lastIndexedAt: string | null;
  lastIndexSha: string | null;
  counts: { skills: number; practices: number; memory: number; lessons: number };
  lastError: string | null;
  github: { appConfigured: boolean; installed: boolean; canWrite: boolean; installUrl: string | null };
}

export interface RegistryCheckView extends PairingCheckView {
  lanes: string[];
  fullName: string | null;
}

export interface RegistryPairingResponse {
  ok?: boolean;
  paired?: boolean;
  check?: RegistryCheckView;
  fullName?: string;
  headSha?: string;
  counts?: { skills?: number; practices?: number; memory?: number; lessons?: number };
  warnings?: string[];
  error?: string;
}

/** POST the registry pairing route (`path: null` unpairs, `verifyOnly` persists nothing). */
export async function postRegistryPairing(
  org: string,
  body: { path: string | null; verifyOnly?: boolean },
): Promise<RegistryPairingResponse> {
  const r = await fetch(`/api/org/${encodeURIComponent(org)}/registry/local`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = (await r.json().catch(() => ({}))) as RegistryPairingResponse;
  if (!r.ok && !d.check && !d.error) d.error = `Request failed (${r.status}).`;
  return d;
}
