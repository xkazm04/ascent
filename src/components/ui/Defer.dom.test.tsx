// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Defer } from "./Defer";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<Defer>", () => {
  it("renders immediately with `immediate`", () => {
    render(
      <Defer immediate placeholder={<span>gap</span>}>
        <span>content</span>
      </Defer>,
    );
    expect(screen.getByText("content")).toBeTruthy();
    expect(screen.queryByText("gap")).toBeNull();
  });

  it("commits a next-frame deferral after the frame", async () => {
    render(
      <Defer strategy="next-frame" placeholder={<span>gap</span>}>
        <span>content</span>
      </Defer>,
    );
    await waitFor(() => expect(screen.getByText("content")).toBeTruthy());
  });

  it("commits an idle deferral (macrotask fallback when rIC is absent)", async () => {
    render(
      <Defer strategy="idle" placeholder={<span>gap</span>}>
        <span>content</span>
      </Defer>,
    );
    await waitFor(() => expect(screen.getByText("content")).toBeTruthy());
  });

  // Fails OPEN: jsdom has no IntersectionObserver, so the subtree must mount anyway. Content that
  // never mounts is a far worse bug than content that mounts early.
  it("fails open when IntersectionObserver is unavailable", async () => {
    expect(typeof (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver).toBe("undefined");
    render(
      <Defer strategy="visible" placeholder={<span>gap</span>}>
        <span>content</span>
      </Defer>,
    );
    await waitFor(() => expect(screen.getByText("content")).toBeTruthy());
  });
});
