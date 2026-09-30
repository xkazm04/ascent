// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RepoRow, RepoRowCell } from "./RepoRow";

describe("RepoRow", () => {
  it("links the name when a report exists and renders the score, level and roles", () => {
    render(
      <ul>
        <RepoRow name="acme/api" href="/report/acme/api" level="L4" score={81} stack={<span>Next.js</span>} chips={<span>queued</span>} cells={<RepoRowCell label="PRs">3</RepoRowCell>} />
      </ul>,
    );
    const name = screen.getByText("acme/api");
    expect(name.getAttribute("href")).toBe("/report/acme/api");
    expect(name.getAttribute("data-role")).toBe("repo-row-name");
    expect(screen.getByText("81").getAttribute("data-role")).toBe("repo-row-figure");
    expect(screen.getByText("L4")).toBeTruthy();
    expect(document.querySelector("[data-kit='repo-row'] [data-role='repo-row-stack']")).toBeTruthy();
    expect(document.querySelector("[data-role='repo-row-chips']")).toBeTruthy();
  });

  it("draws the void mark, never a zero, for an unmeasured score, and stays inert without an href", () => {
    render(
      <ul>
        <RepoRow name="acme/new" score={null} />
      </ul>,
    );
    expect(screen.getByText("acme/new").getAttribute("href")).toBeNull();
    expect(document.querySelector("[data-kit='void-mark']")).toBeTruthy();
    expect(document.querySelector("[data-role='repo-row-figure']")).toBeNull();
  });
});
