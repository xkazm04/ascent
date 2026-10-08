import { describe, it, expect } from "vitest";
import { readBoundedText, WEBHOOK_BODY_MAX_BYTES } from "./body-limit";

function streamOf(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = parts.shift();
      if (next) controller.enqueue(next);
      else controller.close();
    },
  });
}

const req = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { method: "POST", headers, body, duplex: "half" } as RequestInit);

describe("readBoundedText", () => {
  it("the cap is GitHub's 25 MB webhook payload cap", () => {
    expect(WEBHOOK_BODY_MAX_BYTES).toBe(25 * 1024 * 1024);
  });

  it("returns the body at exactly the cap, and null one byte past it", async () => {
    expect(await readBoundedText(req("abcd"), 4)).toBe("abcd");
    expect(await readBoundedText(req("abcde"), 4)).toBeNull();
  });

  it("refuses on Content-Length alone, without reading the body", async () => {
    const body = streamOf([new TextEncoder().encode("ab")]);
    const r = req(body, { "content-length": "999" });
    expect(await readBoundedText(r, 4)).toBeNull();
    expect(r.bodyUsed).toBe(false);
  });

  it("counts the real bytes when Content-Length understates them", async () => {
    const r = req(streamOf([new Uint8Array(3), new Uint8Array(3)]), { "content-length": "2" });
    expect(await readBoundedText(r, 4)).toBeNull();
  });

  it("decodes like request.text(): a split multibyte char and a leading BOM", async () => {
    const raw = "\uFEFF{\"a\":\"✓ 🚀\"}";
    const bytes = new TextEncoder().encode(raw);
    const expected = await req(raw).text();
    const split = await readBoundedText(req(streamOf([bytes.slice(0, 9), bytes.slice(9)])), 1024);
    expect(split).toBe(expected);
  });

  it("an empty body reads as the empty string", async () => {
    expect(await readBoundedText(req(null), 4)).toBe("");
  });
});
