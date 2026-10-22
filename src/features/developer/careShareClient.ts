// The share panel's two requests, to the EXISTING owner-self route (`/api/me/mentor/share`). Auth is
// the browser session the page already holds (same-origin cookies); nothing here adds a credential,
// a header or an identity, and the route is unchanged. Each status is mapped onto a state the panel
// can name, so a refusal carries the server's own reasons.
//
// No "use client": a plain module with no hooks. `refresh` is the caller's `router.refresh`.

export const CARE_SHARE_ROUTE = "/api/me/mentor/share";

export type CareShareOutcome =
  | { state: "saved"; sharedAt: string | null }
  | { state: "deleted" }
  | { state: "refused"; errors: string[] }
  | { state: "signed-out" }
  | { state: "too-large" }
  | { state: "nothing-stored" }
  | { state: "unavailable"; message: string }
  | { state: "failed"; message: string };

async function readJson(res: Response): Promise<{ error?: string; errors?: string[]; sharedAt?: string }> {
  try {
    return (await res.json()) as { error?: string; errors?: string[]; sharedAt?: string };
  } catch {
    return {};
  }
}

/** The statuses both verbs share. */
function common(status: number, body: { error?: string }): CareShareOutcome | null {
  if (status === 401) return { state: "signed-out" };
  if (status === 503) return { state: "unavailable", message: body.error ?? "Sharing is not available here." };
  return null;
}

async function send(method: "POST" | "DELETE", body?: string): Promise<Response | null> {
  try {
    return await fetch(CARE_SHARE_ROUTE, {
      method,
      credentials: "same-origin",
      ...(body !== undefined ? { body, headers: { "content-type": "application/json" } } : {}),
    });
  } catch {
    return null;
  }
}

/** POST the exact text. A 200 refreshes the page so it renders the stored share. */
export async function commitShare(text: string, refresh: () => void): Promise<CareShareOutcome> {
  const res = await send("POST", text);
  if (!res) return { state: "failed", message: "The share did not reach the server." };
  const body = await readJson(res);
  if (res.ok) {
    refresh();
    return { state: "saved", sharedAt: body.sharedAt ?? null };
  }
  if (res.status === 400) return { state: "refused", errors: body.errors?.length ? body.errors : [body.error ?? "The share was refused."] };
  if (res.status === 413) return { state: "too-large" };
  return common(res.status, body) ?? { state: "failed", message: body.error ?? "Failed to store your share." };
}

/** DELETE the stored share. The row is removed whole; a 200 refreshes the page. */
export async function deleteShare(refresh: () => void): Promise<CareShareOutcome> {
  const res = await send("DELETE");
  if (!res) return { state: "failed", message: "The request did not reach the server." };
  const body = await readJson(res);
  if (res.ok) {
    refresh();
    return { state: "deleted" };
  }
  if (res.status === 404) return { state: "nothing-stored" };
  return common(res.status, body) ?? { state: "failed", message: body.error ?? "Failed to delete your share." };
}
