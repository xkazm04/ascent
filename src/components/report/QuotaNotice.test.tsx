// @vitest-environment jsdom
//
// The "Sign in for more scans" CTA is a volume promise. At the default hosted pair the signed-in
// and anonymous public-scan limits are equal, so offering it would be a user-facing untruth.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { canOfferSignIn, QuotaBanner, QuotaBlocked } from "./QuotaNotice";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function withAuthEnv() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
}

describe("canOfferSignIn", () => {
  it("is false at the default (signed-in limit equals anonymous), even with auth wired", () => {
    withAuthEnv();
    expect(canOfferSignIn("anon")).toBe(false);
  });

  it("is true only when the signed-in limit is actually higher", () => {
    withAuthEnv();
    vi.stubEnv("PUBLIC_SCAN_MONTHLY_LIMIT_SIGNED_IN", "50");
    expect(canOfferSignIn("anon")).toBe(true);
    expect(canOfferSignIn("user")).toBe(false);
  });

  it("is false without supabase, even when signing in would raise the limit", () => {
    vi.stubEnv("PUBLIC_SCAN_MONTHLY_LIMIT_SIGNED_IN", "50");
    expect(canOfferSignIn("anon")).toBe(false);
  });
});

describe("QuotaBlocked / QuotaBanner — no false volume promise", () => {
  it("does not promise 'Sign in for more scans' when the two limits match", () => {
    withAuthEnv();
    render(<QuotaBlocked message="used up" scope="anon" signInNext="/report" />);
    expect(screen.queryByRole("button", { name: "Sign in for more scans" })).toBeNull();
    expect(screen.getByRole("link", { name: /see plans/i })).toBeInTheDocument();
  });

  it("offers sign-in when the signed-in allowance is actually higher", () => {
    withAuthEnv();
    vi.stubEnv("PUBLIC_SCAN_MONTHLY_LIMIT_SIGNED_IN", "50");
    render(<QuotaBlocked message="used up" scope="anon" signInNext="/report" />);
    expect(screen.getByRole("button", { name: "Sign in for more scans" })).toBeInTheDocument();
  });

  it("QuotaBanner does not say Sign in for more when limits are equal", () => {
    withAuthEnv();
    render(<QuotaBanner remaining={2} resetAt={null} scope="anon" signInNext="/" />);
    expect(screen.queryByRole("button", { name: /sign in for more/i })).toBeNull();
  });
});
