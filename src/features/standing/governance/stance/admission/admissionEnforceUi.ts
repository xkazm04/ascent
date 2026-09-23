// Shared chrome and the one request helper for the Enforce panel's two halves (CODEOWNERS and the
// ruleset). Co-located so both components stay under this directory's 200-LOC cap and cannot drift
// into two different ways of reading a refusal. No hooks: this file carries no "use client".

export const FIELD =
  "rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono type-micro text-slate-200 outline-none focus:border-accent disabled:opacity-40";

export const BTN =
  "focus-ring rounded-md border border-slate-700 px-3 py-1 font-mono type-micro uppercase tracking-[0.14em] text-slate-300 transition hover:border-accent/50 hover:text-white disabled:opacity-40";

/** The button that changes a customer's repository. Accent-orange, like Withdraw beside it. */
export const BTN_DANGER =
  "focus-ring rounded-md border border-orange-400/50 bg-orange-500/10 px-3 py-1 font-mono type-micro uppercase tracking-[0.14em] text-orange-200 transition hover:bg-orange-500/20 disabled:opacity-40";

/** A refusal the route answered with, kept whole so a caller can branch on `code` (content-drift). */
export class EnforceRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EnforceRequestError";
  }
}

/** JSON in, JSON out; a non-2xx throws with the route's own `error` sentence. */
export async function sendJson(url: string, method: "POST" | "DELETE", body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new EnforceRequestError(typeof data.error === "string" ? data.error : "The request was refused.", res.status, data);
  }
  return data;
}
