// respondError must be WIRE-IDENTICAL to the hand-rolled NextResponse.json({error}, {status}) it
// replaces — that is what makes migrating 500 call sites one at a time safe — and it must report only
// unexpected failures, never the working system.
// Architect ADR 2026-08-28-route-response-seam.

import { describe, expect, it } from "vitest";
import { respondError } from "@/lib/api/respond";

describe("respondError", () => {
  it("produces the app's canonical envelope", async () => {
    const res = respondError(400, "Missing org.");
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Missing org." });
  });

  it("includes `code` only when given, matching the hand-rolled shape", async () => {
    await expect(respondError(422, "empty", { code: "EMPTY" }).json()).resolves.toEqual({
      error: "empty",
      code: "EMPTY",
    });
    // No `code` key at all rather than `code: undefined` — JSON.stringify drops undefined, so the two
    // are wire-identical, but asserting the object keeps the parity explicit.
    await expect(respondError(422, "empty").json()).resolves.toEqual({ error: "empty" });
  });

  it("passes headers through", () => {
    const res = respondError(429, "slow down", { headers: { "retry-after": "60" } });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  // Reporting is scheduled with `after()`, which throws outside a request scope. A unit test calling
  // respondError directly IS outside one, so this asserts the guard: telemetry must never be able to
  // turn an error response into a crash.
  it("still answers when there is no request scope to schedule reporting against", async () => {
    const res = respondError(500, "boom", { cause: new Error("underlying") });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "boom" });
  });

  it("answers a 4xx with a cause without throwing", async () => {
    const res = respondError(400, "bad input", { cause: new Error("parse failed") });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "bad input" });
  });
});
