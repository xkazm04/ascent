import { afterEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue(true) }));
vi.mock("./email/alert-sink", () => ({ dispatchAlertEmail: h.send }));
import { dispatchAlert } from "./alerts";
afterEach(() => { h.send.mockClear(); vi.unstubAllGlobals(); });
const message = { text: "fixture", blocks: [] };

describe("alert cancellation before delivery", () => {
  it("does not send an email for an already cancelled scan", async () => {
    const signal = AbortSignal.abort();
    expect(await dispatchAlert(message, { webhookUrl: "mailto:ops@example.test", signal })).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("checks cancellation again after loading the email transport", async () => {
    const controller = new AbortController();
    const result = dispatchAlert(message, { webhookUrl: "mailto:ops@example.test", signal: controller.signal });
    controller.abort();
    expect(await result).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("does not start webhook I/O for an already cancelled scan", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await dispatchAlert(message, { webhookUrl: "https://hooks.example.test/fixture", signal: AbortSignal.abort() })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still delivers a configured email when the caller is active", async () => {
    expect(await dispatchAlert(message, { webhookUrl: "mailto:ops@example.test", org: "acme" })).toBe(true);
    expect(h.send).toHaveBeenCalledWith("ops@example.test", message, { org: "acme" });
  });
});
