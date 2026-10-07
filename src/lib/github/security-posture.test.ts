// fetchSecurityPosture: a FAILED read rejects (so the ingest's sensor-failure door records it); a
// resolved value is always a successful read. A 404 stays a real zero / false.

import { afterEach, describe, it, expect, vi } from "vitest";
import { fetchSecurityPosture } from "./security-posture";

type Answer = number | Error | { status: number; body: unknown };

/** Route fetch by URL: advisories vs the three org-policy probe paths. */
function stubFetch(advisories: Answer, probes: Record<string, Answer> | Answer) {
  const answer = (a: Answer): Response => {
    if (a instanceof Error) throw a;
    if (typeof a === "number") return new Response("[]", { status: a });
    return new Response(typeof a.body === "string" ? a.body : JSON.stringify(a.body), { status: a.status });
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/security-advisories")) return answer(advisories);
    const path = url.split("/contents/")[1];
    const a = typeof probes === "number" || probes instanceof Error || "status" in (probes as object)
      ? (probes as Answer)
      : ((probes as Record<string, Answer>)[path] ?? 404);
    return answer(a);
  }));
}

const ok = (n: number) => ({ status: 200, body: Array.from({ length: n }, () => ({})) });
const run = () => fetchSecurityPosture("acme", "r", "t");

afterEach(() => vi.unstubAllGlobals());

describe("fetchSecurityPosture", () => {
  it("200 advisories + 200 policy → the counts", async () => {
    stubFetch(ok(3), { "SECURITY.md": 200 });
    expect(await run()).toEqual({ advisoryCount: 3, advisoryCapped: false, orgSecurityPolicy: true });
  });

  it("caps at a full page", async () => {
    stubFetch(ok(100), 404);
    expect((await run())!.advisoryCapped).toBe(true);
  });

  it("404 advisories and 404 on every probe is a real zero / false, not a failure", async () => {
    stubFetch(404, 404);
    expect(await run()).toEqual({ advisoryCount: 0, advisoryCapped: false, orgSecurityPolicy: false });
  });

  it("a 5xx advisory read rejects", async () => {
    stubFetch(502, 404);
    await expect(run()).rejects.toThrow(/502/);
  });

  it("a 403 advisory read rejects", async () => {
    stubFetch(403, 404);
    await expect(run()).rejects.toThrow(/403/);
  });

  it("a malformed 200 advisory body rejects", async () => {
    stubFetch({ status: 200, body: { not: "an array" } }, 404);
    await expect(run()).rejects.toThrow(/malformed/);
    stubFetch({ status: 200, body: "<html>" }, 404);
    await expect(run()).rejects.toThrow(/malformed/);
  });

  it("a thrown fetch rejects", async () => {
    stubFetch(new Error("ECONNRESET"), 404);
    await expect(run()).rejects.toThrow("ECONNRESET");
  });

  it("a later probe answering 200 wins over an earlier failed probe", async () => {
    stubFetch(404, { "SECURITY.md": 500, "profile/SECURITY.md": new Error("boom"), ".github/SECURITY.md": 200 });
    expect((await run())!.orgSecurityPolicy).toBe(true);
  });

  it("a probe that threw with no 200 anywhere rejects", async () => {
    stubFetch(404, { "SECURITY.md": new Error("timeout") });
    await expect(run()).rejects.toThrow("timeout");
  });

  it("a probe that answered 5xx/403 with no 200 anywhere rejects", async () => {
    stubFetch(404, { "profile/SECURITY.md": 503 });
    await expect(run()).rejects.toThrow(/503/);
    stubFetch(404, { "SECURITY.md": 403 });
    await expect(run()).rejects.toThrow(/403/);
  });
});
