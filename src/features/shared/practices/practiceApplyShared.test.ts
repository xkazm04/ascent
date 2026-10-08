// readApiResponse: a practice route's answer, read without trusting the body to be JSON.
import { describe, it, expect } from "vitest";
import { readApiResponse } from "./practiceApplyShared";

const res = (status: number, body: string) => new Response(body, { status });

describe("readApiResponse", () => {
  it("passes a successful JSON body through", async () => {
    expect(await readApiResponse(res(200, '{"url":"u"}'), "fb")).toEqual({ ok: true, data: { url: "u" } });
  });

  it("keeps the server's error and code", async () => {
    expect(await readApiResponse(res(409, '{"error":"Re-preview.","code":"content-drift"}'), "fb")).toEqual({
      ok: false,
      error: "Re-preview.",
      code: "content-drift",
    });
  });

  it("answers the fallback for a non-JSON body, an empty body, or an error without text", async () => {
    for (const r of [res(504, "<html>Gateway Timeout</html>"), res(502, ""), res(500, '{"error":""}'), res(500, "null")]) {
      expect(await readApiResponse(r, "fb")).toEqual({ ok: false, error: "fb" });
    }
  });

  it("a 200 whose body is not JSON is a failure with the fallback, not a crash", async () => {
    expect(await readApiResponse(res(200, "<html></html>"), "fb")).toEqual({ ok: false, error: "fb" });
  });
});
