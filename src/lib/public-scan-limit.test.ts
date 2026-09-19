import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  publicScanMonthlyLimit,
  signInRaisesPublicScanLimit,
  signedInScanMonthlyLimit,
} from "./public-scan-limit";

const KEYS = ["PUBLIC_SCAN_MONTHLY_LIMIT", "PUBLIC_SCAN_MONTHLY_LIMIT_SIGNED_IN"] as const;

function withEnv(vals: Partial<Record<(typeof KEYS)[number], string>>, fn: () => void) {
  const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) {
    if (vals[k] === undefined) delete process.env[k];
    else process.env[k] = vals[k];
  }
  try {
    fn();
  } finally {
    for (const k of KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k]!;
    }
  }
}

function collectSrc(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectSrc(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("signInRaisesPublicScanLimit", () => {
  it("is false at the default (signed-in limit equals anonymous)", () => {
    withEnv({}, () => {
      expect(publicScanMonthlyLimit()).toBe(5);
      expect(signedInScanMonthlyLimit()).toBe(5);
      expect(signInRaisesPublicScanLimit()).toBe(false);
    });
  });

  it("is true when the signed-in override is higher", () => {
    withEnv({ PUBLIC_SCAN_MONTHLY_LIMIT_SIGNED_IN: "50" }, () => {
      expect(signInRaisesPublicScanLimit()).toBe(true);
    });
  });

  it("is false when the signed-in override is clamped to the anonymous floor", () => {
    withEnv({ PUBLIC_SCAN_MONTHLY_LIMIT: "8", PUBLIC_SCAN_MONTHLY_LIMIT_SIGNED_IN: "2" }, () => {
      expect(signedInScanMonthlyLimit()).toBe(8);
      expect(signInRaisesPublicScanLimit()).toBe(false);
    });
  });

  it("is true when the anonymous cap is below the signed-in default of 5", () => {
    withEnv({ PUBLIC_SCAN_MONTHLY_LIMIT: "1" }, () => {
      expect(signInRaisesPublicScanLimit()).toBe(true);
    });
  });
});

describe("Sign in for more scans copy is gated on the limit comparison", () => {
  it("the label only lives in QuotaMeter and QuotaNotice, both behind canOfferSignIn", () => {
    const hits = collectSrc(join(process.cwd(), "src")).filter((p) =>
      readFileSync(p, "utf8").includes("Sign in for more scans"),
    );
    const rel = hits.map((p) => relative(process.cwd(), p).replaceAll("\\", "/")).sort();
    expect(rel).toEqual(["src/components/QuotaMeter.tsx", "src/components/report/QuotaNotice.tsx"]);
    for (const p of hits) {
      expect(readFileSync(p, "utf8")).toContain("canOfferSignIn");
    }
    const notice = readFileSync(join(process.cwd(), "src/components/report/QuotaNotice.tsx"), "utf8");
    expect(notice).toContain("signInRaisesPublicScanLimit()");
  });
});
