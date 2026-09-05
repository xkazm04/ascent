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
