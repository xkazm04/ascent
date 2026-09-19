// The wire contract, from the client's side. The route names each SSE frame after the turn's own
// event `type`, so these assertions and `turn.ts`'s union are the same document read from two ends.
//
// The `delta` case is the one worth keeping: token streaming does not exist yet, the union has room
// for it, and an unknown frame must come back as null rather than throwing — otherwise the day it
// ships, every un-updated client crashes mid-answer instead of quietly rendering from `settled`.

import { describe, it, expect } from "vitest";
import { parseSSE } from "@/lib/sse";
import { toAthenaEvent } from "./stream";

const frame = (event: string, data: unknown) => parseSSE(`event: ${event}\ndata: ${JSON.stringify(data)}`);

describe("toAthenaEvent — the five names", () => {
  it("reads a phase, and only a real one", () => {
    expect(toAthenaEvent(frame("phase", { phase: "grounding" }))).toEqual({ type: "phase", phase: "grounding" });
    expect(toAthenaEvent(frame("phase", { phase: "daydreaming" }))).toBeNull();
    expect(toAthenaEvent(frame("phase", {}))).toBeNull();
  });

  it("reads recall chips and drops malformed ones", () => {
    expect(toAthenaEvent(frame("recall", { chips: [{ insight: "a" }, { nope: 1 }] }))).toEqual({
      type: "recall",
      chips: [{ insight: "a" }],
    });
    // Nothing survived ⇒ no event at all, not an empty strip.
    expect(toAthenaEvent(frame("recall", { chips: [{ nope: 1 }] }))).toBeNull();
    expect(toAthenaEvent(frame("recall", { chips: "many" }))).toBeNull();
  });

  it("reads a tool by name and refuses a nameless one", () => {
    expect(toAthenaEvent(frame("tool", { name: "org_rollup" }))).toEqual({ type: "tool", name: "org_rollup" });
    expect(toAthenaEvent(frame("tool", { name: "" }))).toBeNull();
  });

  it("reads a settled turn only when it carries an id", () => {
    const turn = { id: "t1", role: "assistant", content: "hi", meta: {} };
    expect(toAthenaEvent(frame("settled", { turn }))).toEqual({ type: "settled", turn });
    expect(toAthenaEvent(frame("settled", { turn: { role: "assistant" } }))).toBeNull();
    expect(toAthenaEvent(frame("settled", {}))).toBeNull();
  });

  it("always yields a sentence for an error frame, even a blank one", () => {
    expect(toAthenaEvent(frame("error", { message: "Refused." }))).toEqual({ type: "error", message: "Refused." });
    expect(toAthenaEvent(frame("error", {}))).toEqual({ type: "error", message: "The turn failed." });
  });
});

describe("toAthenaEvent — everything else", () => {
  it("ignores the terminator and keepalives", () => {
    expect(toAthenaEvent(frame("done", { ok: true }))).toBeNull();
    expect(toAthenaEvent(parseSSE(""))).toBeNull();
  });

  it("ignores a frame the union has room for but this client does not read yet", () => {
    expect(toAthenaEvent(frame("delta", { text: "partial" }))).toBeNull();
  });

  it("ignores a frame whose data failed to parse", () => {
    expect(toAthenaEvent(parseSSE("event: settled\ndata: {not json"))).toBeNull();
  });
});
