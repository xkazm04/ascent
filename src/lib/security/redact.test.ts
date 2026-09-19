// The one redactor, pinned per shape. Every named pattern carries a KNOWN POSITIVE (the secret must be
// gone) and a BENIGN NEAR MISS (text that looks close and must come back byte-identical), and a
// structural test fails when a pattern is added without both. Seeded from ascent's eval-log cases
// (committed-repo shapes) and the AI Engineering Coach's redact-secrets tests (pasted-transcript shapes).

import { describe, expect, it } from "vitest";
import { REDACTED, REDACTION_PATTERNS, redactSecrets } from "./redact";

const CASES: Record<string, { positive: string; secret: string; nearMiss: string }> = {
  "private-key": {
    positive: "key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0aB\nc3d4e5f6\n-----END RSA PRIVATE KEY-----\ndone",
    secret: "MIIEowIBAAKCAQEA0aB",
    nearMiss: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOC\n-----END PUBLIC KEY-----",
  },
  "google-api-key": {
    positive: "GEMINI_KEY is AIzaSyD-1234567890abcdefghijklmnopqrstu here",
    secret: "AIzaSyD-1234567890abcdefghijklmnopqrstu",
    nearMiss: "the AIzaShortKey123 placeholder",
  },
  "stripe-key": {
    positive: "STRIPE sk_live_51H8xKfLkd0293ndkAOSJ and rk_test_ABCDEFGHIJ1234567890",
    secret: "sk_live_51H8xKfLkd0293ndkAOSJ",
    nearMiss: "set sk_live_abc in the dashboard",
  },
  "sk-api-key": {
    positive: "use sk-abcdefghijklmnopqrstuvwx please",
    secret: "sk-abcdefghijklmnopqrstuvwx",
    nearMiss: "pip install sk-learn first",
  },
  "github-token": {
    positive: "push failed: ghp_abcdefghijklmnopqrstuvwxyz0123456789 and github_pat_11ABCDEFG0123456789_abcdefghij",
    secret: "github_pat_11ABCDEFG0123456789_abcdefghij",
    nearMiss: "the ghp_short prefix is documented",
  },
  "gitlab-pat": {
    positive: "token glpat-abcdefghijklmnopqrst end",
    secret: "glpat-abcdefghijklmnopqrst",
    nearMiss: "a glpat-short example",
  },
  "npm-token": {
    positive: "//registry.npmjs.org/:_authToken npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
    secret: "npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
    nearMiss: "read npm_config_registry from the environment",
  },
  "aws-access-key-id": {
    positive: "key AKIAIOSFODNN7EXAMPLE and ASIAIOSFODNN7EXAMPLE",
    secret: "AKIAIOSFODNN7EXAMPLE",
    nearMiss: "AKIA1234 is not a full key id",
  },
  "aws-secret-labelled": {
    positive: "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    secret: "wJalrXUtnFEMI/K7MDENG",
    nearMiss: "aws_secret_access_key is read from the environment",
  },
  "slack-token": {
    positive: "xoxb-1234567890-abcdef",
    secret: "xoxb-1234567890-abcdef",
    nearMiss: "an xoxb-short token prefix",
  },
  "slack-app-token": {
    positive: "xapp-1-A0123456789-abcdef",
    secret: "A0123456789-abcdef",
    nearMiss: "an xapp-1-short value",
  },
  jwt: {
    positive: "auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    secret: "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    nearMiss: "the header eyJhbGci.e30.sig is truncated",
  },
  "connection-string": {
    positive: "DB=postgres://admin:s3cr3tP4ss@db.example.com:5432/app",
    secret: "s3cr3tP4ss",
    nearMiss: "DB=postgres://db.example.com:5432/app",
  },
  "auth-header": {
    positive: "Authorization: Bearer abcdef0123456789abcdef",
    secret: "abcdef0123456789abcdef",
    nearMiss: "a Bearer token is expected here",
  },
  "quoted-assignment": {
    positive: '"password": "two words here"',
    secret: "two words here",
    nearMiss: '"password": "abc"',
  },
  "key-value-assignment": {
    positive: "api_key=super-secret-value-123",
    secret: "super-secret-value-123",
    nearMiss: "tokens: 1234567890 and the secret: keep it",
  },
};

describe("redactSecrets: one positive and one near miss per pattern", () => {
  it("covers every named pattern, and nothing else", () => {
    expect(Object.keys(CASES).sort()).toEqual(REDACTION_PATTERNS.map((p) => p.name).sort());
  });

  for (const p of REDACTION_PATTERNS) {
    it(`${p.name}: removes the known positive`, () => {
      const c = CASES[p.name]!;
      // The pattern ITSELF must bite, not a neighbour: run it alone before the whole chain.
      expect(c.positive.replace(new RegExp(p.re.source, p.re.flags), p.replace)).not.toContain(c.secret);
      const out = redactSecrets(c.positive);
      expect(out).not.toContain(c.secret);
      expect(out).toContain(REDACTED);
    });

    it(`${p.name}: leaves the benign near miss byte-identical`, () => {
      const c = CASES[p.name]!;
      expect(redactSecrets(c.nearMiss)).toBe(c.nearMiss);
    });
  }
});

describe("redactSecrets: frames and whole-shape behaviour", () => {
  it("redacts PEM key MATERIAL whole, not just the header", () => {
    expect(redactSecrets("-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIBmS\nAwEHoUQDQgAE\n-----END EC PRIVATE KEY-----")).toBe(REDACTED);
    expect(redactSecrets("-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA\n-----END OPENSSH PRIVATE KEY-----")).toBe(REDACTED);
  });

  it("redacts a PEM block cut off by an excerpt budget", () => {
    expect(redactSecrets("-----BEGIN PRIVATE KEY-----\nMIIEow")).not.toContain("MIIEow");
  });

  it("keeps the scheme and host of a connection string, the auth scheme, and the key name", () => {
    expect(redactSecrets("postgres://admin:s3cr3tP4ss@db.example.com:5432/app")).toBe(`postgres://${REDACTED}@db.example.com:5432/app`);
    expect(redactSecrets("Authorization: Bearer abcdef0123456789abcdef")).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(redactSecrets("api_key=super-secret-value-123")).toBe(`api_key=${REDACTED}`);
    expect(redactSecrets("secret = 'a longer pass phrase'")).toBe(`secret = '${REDACTED}'`);
    expect(redactSecrets('"password": "hunter2hunter2"')).toBe(`"password": "${REDACTED}"`);
  });

  it("leaves a bare 40-char blob alone: redacting every hash would gut the excerpts", () => {
    const sha = "commit a94a8fe5ccb19ba61c4c0873d391e987982fbbd3 touched src/index.ts";
    expect(redactSecrets(sha)).toBe(sha);
  });

  it("leaves ordinary prose and prompt text untouched, and handles empty input", () => {
    for (const text of [
      "REPOSITORY acme/widget | Language: TypeScript | Stars: 10",
      "Refactor the parser to use async/await and add a test for empty input.",
    ]) {
      expect(redactSecrets(text)).toBe(text);
    }
    expect(redactSecrets("")).toBe("");
  });

  it("masks secrets inside a serialized JSON payload and the result still parses", () => {
    // The escaped-quote lesson is the one that leaked through the memory tool before the patterns
    // accepted \" : a tool result reaches the model as serialized JSON.
    const payload = {
      lessons: [
        "deploy with token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        "db is postgres://admin:s3cr3tPass@host/db",
        'config had "password": "two words here" and "api_key": "hunter2hunter2"',
      ],
      note: "ok",
    };
    const out = redactSecrets(JSON.stringify(payload, null, 2));
    for (const secret of ["ghp_abcdefghijklmnopqrstuvwxyz0123456789", "s3cr3tPass", "two words here", "hunter2hunter2"]) {
      expect(out).not.toContain(secret);
    }
    const reparsed = JSON.parse(out) as { lessons: string[]; note: string };
    expect(reparsed.lessons).toHaveLength(3);
    expect(reparsed.lessons[2]).toBe(`config had "password": "${REDACTED}" and "api_key": "${REDACTED}"`);
    expect(reparsed.note).toBe("ok");
  });
});
