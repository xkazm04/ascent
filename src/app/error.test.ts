// Pins the root-segment error boundary (src/app/error.tsx) — the application-wide fallback rendered
// when any throw escapes a nearer error.tsx (notably a throw inside a nested layout). It is a thin
// "use client" component with no extractable pure helper, so — exactly like report-document.test.ts —
// we invoke the component function directly and walk the returned React element tree, asserting on
// node props/children. No jsdom / DOM render needed.
//
// The invariants the fallback must never break:
//   1. DIGEST RENDERED — when `error.digest` is present, the "Reference: <digest>" line appears so the
//      user can quote it to support; when absent, that line is OMITTED (no "Reference:" with an empty
//      or undefined id, no crash).
//   2. RESET WIRED — the "Try again" button's onClick invokes the `reset` callback (clicking it calls
//      reset exactly once). This is the boundary's one piece of behavior; a broken wire = un-retryable.
//   3. NO RAW LEAK — the rendered tree shows the safe generic copy and the digest only; it never
//      surfaces the raw Error.message or .stack (which can carry secrets/internals).
//
// The component opens with `useEffect(() => console.error(...))`. Invoked outside React's render that
// reads a null dispatcher and throws, so we mock `react`'s useEffect to a no-op — the rest of React
// (createElement, isValidElement, Children) is preserved by spreading the real module. The component
// source is untouched.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useEffect: () => {} };
});

// Import AFTER the mock is registered so the component closes over the no-op useEffect.
const { default: AppError } = await import("./error");

// ── React element-tree walker (pure; mirrors report-document.test.ts) ───────────────────────────────
type El = ReactElement<{ style?: unknown; children?: ReactNode; onClick?: () => void; href?: string }>;

/** Depth-first list of every React element in the tree. */
function flatten(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) flatten(n, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as El;
  out.push(el);
  flatten(el.props?.children, out);
  return out;
}

/** Concatenate the primitive (string/number) descendants of a node into one string. */
function textOf(node: ReactNode): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node as El).props?.children);
  return "";
}

function makeError(overrides: Partial<Error & { digest?: string }> = {}): Error & { digest?: string } {
  const err = new Error(overrides.message ?? "boom secret-token-abc123") as Error & { digest?: string };
  err.stack = overrides.stack ?? "Error: boom secret-token-abc123\n    at /app/secret/path.ts:42:7";
  if ("digest" in overrides) err.digest = overrides.digest;
  return err;
}

/** Build the element tree for the boundary, given an error + a reset spy. */
function tree(error: Error & { digest?: string }, reset: () => void = () => {}): El[] {
  return flatten(AppError({ error, reset }));
}

/** All concatenated text in the tree. */
function allText(els: El[]): string {
  return els.map((el) => textOf(el.props?.children)).join(" ");
}

describe("AppError — digest rendering (via the rendered element tree)", () => {
  it("renders the 'Reference: <digest>' line when error.digest is present", () => {
    const els = tree(makeError({ digest: "DIGEST_9f3a1" }));
    const line = els.find((el) => textOf(el).includes("Reference:"));
    expect(line).toBeDefined();
    expect(textOf(line!)).toContain("DIGEST_9f3a1");
  });

  it("OMITS the Reference line entirely when digest is absent", () => {
    const els = tree(makeError()); // no digest key
    expect(els.some((el) => textOf(el).includes("Reference:"))).toBe(false);
  });

  it("OMITS the Reference line when digest is an empty string (falsy guard)", () => {
    const els = tree(makeError({ digest: "" }));
    expect(els.some((el) => textOf(el).includes("Reference:"))).toBe(false);
  });

  it("does not throw when building the tree with a missing digest", () => {
    expect(() => tree(makeError())).not.toThrow();
  });
});

describe("AppError — reset wiring", () => {
  let reset: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reset = vi.fn();
  });

  /** The 'Try again' button element. */
  function tryAgainButton(els: El[]): El | undefined {
    return els.find((el) => el.type === "button" && textOf(el).trim() === "Try again");
  }

  it("wires the 'Try again' button's onClick to invoke reset", () => {
    const btn = tryAgainButton(tree(makeError(), reset));
    expect(btn).toBeDefined();
    expect(reset).not.toHaveBeenCalled();
    btn!.props.onClick?.();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("the only reset-invoking control is the Try again button (not the home link)", () => {
    const els = tree(makeError(), reset);
    // Click everything with an onClick; reset must fire exactly once (from Try again).
    for (const el of els) el.props.onClick?.();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("AppError — no raw error leak", () => {
  it("renders the safe generic copy and never the raw Error.message", () => {
    const text = allText(tree(makeError({ message: "boom secret-token-abc123", digest: "D1" })));
    expect(text).toContain("Something went wrong");
    expect(text).toContain("An unexpected error occurred");
    expect(text).not.toContain("secret-token-abc123");
  });

  it("never renders the raw stack trace", () => {
    const text = allText(tree(makeError({ stack: "Error: x\n    at /app/secret/path.ts:42:7" })));
    expect(text).not.toContain("/app/secret/path.ts");
    expect(text).not.toContain("at ");
  });

  it("shows only the digest as an error identifier, not the message/stack", () => {
    const text = allText(tree(makeError({ message: "leak-me", stack: "stack-leak", digest: "SAFE_DIGEST" })));
    expect(text).toContain("SAFE_DIGEST");
    expect(text).not.toContain("leak-me");
    expect(text).not.toContain("stack-leak");
  });
});
