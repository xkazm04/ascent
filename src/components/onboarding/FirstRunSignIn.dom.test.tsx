// @vitest-environment jsdom
//
// The hosted cloud's signed-out panel must not promise a scan the wall refuses: with the wall up a
// signed-out scan answers 401 ("Sign in to run this scan"), so "without an account" was false.

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FirstRunSignIn } from "./FirstRunSignIn";

describe("FirstRunSignIn (cloud, signed out)", () => {
  it("does not offer a scan without an account", () => {
    render(<FirstRunSignIn mode="cloud" auth="github" />);
    expect(document.body.textContent).not.toMatch(/without an account/i);
  });

  it("says only what is true: signed in, any public organization, up to 10 repositories", () => {
    render(<FirstRunSignIn mode="cloud" auth="github" />);
    expect(document.body.textContent).toMatch(/once you.re signed in/i);
    expect(document.body.textContent).toMatch(/up to 10 repositories of any public organization/i);
  });
});
