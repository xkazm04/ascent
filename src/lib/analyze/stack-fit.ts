// Stack-fit detection — names the blind spot when a repo's stack is one the (web/service-tuned)
// maturity rubric is known to under-read, so the score can carry an honest "partial fit" caveat
// instead of silently mismeasuring. From the pricing-20 UAT: an ML/notebook repo was the only FAIL
// (Arjun — scored low for missing unit tests its notebooks never have), and mobile (Sofia — D3 reads
// web CI, not release trains) and embedded (Klaus — low-velocity by design) were downgrades. The fix
// the synthesis asked for is honesty, not re-scoring: surface the caveat, don't change the number.
//
// Two entry points: detectStackFit() runs at scan time over the full file tree (catches weak-language
// cases like notebooks inside a "Python" repo); stackFitFromLanguage() runs at read time over a
// persisted report (which keeps the primary language but not the tree) so the caveat survives reloads.

import type { RepoSnapshot } from "@/lib/types";

export type StackKind = "ml" | "mobile" | "embedded";

export interface StackFit {
  stack: StackKind;
  caveat: string;
}

const CAVEAT: Record<StackKind, string> = {
  ml: "Partial fit: this looks like an ML / notebook project. Automated Testing (D2) and Code Quality & Guardrails (D6) are tuned for application/service code and under-read experiment-driven notebook work — read those dimensions as a floor, not a verdict.",
  mobile: "Partial fit: this looks like a mobile app. CI/CD & Delivery (D3) reads web/service pipelines, so a mobile release train (fastlane / Xcode Cloud / app-store submission, code signing) may not be fully credited.",
  embedded: "Partial fit: this looks like an embedded / firmware project — typically low-velocity and safety-gated by design. The AI-native maturity ladder targets application development, so a low level can be expected and the trajectory is best read as informational.",
};

const ML_LANGS = new Set(["jupyter notebook"]);
// Strong mobile signals on their own; Kotlin/Java are also server-side, so they need a manifest (below).
const MOBILE_LANGS = new Set(["swift", "objective-c", "objective-c++", "dart"]);
const EMBEDDED_LANGS = new Set(["c", "c++", "rust", "assembly", "ada", "verilog", "vhdl"]);

/**
 * Stack-fit from the primary language alone — the durable signal available on a persisted report
 * (which has no file tree). Conservative: only languages that on their own strongly imply a stack the
 * rubric under-reads. Embedded is deliberately omitted here (C/C++ is too broad without a tree signal).
 */
export function stackFitFromLanguage(language: string | null | undefined): StackFit | null {
  const lang = (language ?? "").toLowerCase().trim();
  if (!lang) return null;
  if (ML_LANGS.has(lang)) return { stack: "ml", caveat: CAVEAT.ml };
  if (MOBILE_LANGS.has(lang)) return { stack: "mobile", caveat: CAVEAT.mobile };
  return null;
}

/**
 * Full stack-fit from a fresh snapshot: the language signal enriched with file-tree evidence
 * (notebooks, mobile/app manifests, firmware build files), so weak-language cases — notebooks inside a
 * repo GitHub labels "Python", a Kotlin/Java mobile app — are still caught. Returns null for a full-fit
 * (web/service) stack: no caveat is the common, correct outcome.
 */
export function detectStackFit(snap: Pick<RepoSnapshot, "meta" | "tree">): StackFit | null {
  const lang = (snap.meta.primaryLanguage ?? "").toLowerCase().trim();
  const paths = snap.tree.map((t) => t.path.toLowerCase());
  const total = paths.length || 1;

  // ML: a notebook-first language, OR a meaningful share of .ipynb in the tree.
  const notebooks = paths.filter((p) => p.endsWith(".ipynb")).length;
  if (ML_LANGS.has(lang) || notebooks >= 3 || notebooks / total >= 0.1) return { stack: "ml", caveat: CAVEAT.ml };

  // Mobile: a strong mobile language, OR app/build manifests (this catches Kotlin/Java mobile too).
  const mobileManifest = paths.some(
    (p) =>
      p.endsWith(".xcodeproj") ||
      p.endsWith(".xcworkspace") ||
      p.endsWith(".xcconfig") ||
      p === "podfile" ||
      p.endsWith("/podfile") ||
      p.endsWith("/info.plist") ||
      p.endsWith("androidmanifest.xml") ||
      p.endsWith("pubspec.yaml") ||
      p.includes("fastlane/"),
  );
  if (MOBILE_LANGS.has(lang) || mobileManifest) return { stack: "mobile", caveat: CAVEAT.mobile };

  // Embedded: a systems language AND a firmware/hardware build signal, and NOT a web/service project
  // (CMake alone is too broad, so we key off platformio/Arduino/Kconfig/linker/device-tree files).
  const embeddedSignal = paths.some(
    (p) =>
      p.endsWith("platformio.ini") ||
      p.endsWith(".ino") ||
      p === "kconfig" ||
      p.endsWith("/kconfig") ||
      p.endsWith(".ld") ||
      p.endsWith(".dts") ||
      p.endsWith(".dtsi"),
  );
  const webish = paths.some(
    (p) => p.endsWith("package.json") || p.endsWith("go.mod") || p.endsWith("requirements.txt") || p.endsWith("pom.xml"),
  );
  if (EMBEDDED_LANGS.has(lang) && embeddedSignal && !webish) return { stack: "embedded", caveat: CAVEAT.embedded };

  return null;
}
